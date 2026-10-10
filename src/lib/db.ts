import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { DocMeta, StudyNode } from "./types";

/**
 * Local-first persistence in IndexedDB. Everything (PDF bytes, the discussion
 * tree and notes) lives in the learner's browser; nothing is stored server-side.
 */

interface StudyDB extends DBSchema {
  docs: { key: string; value: DocMeta };
  files: { key: string; value: { id: string; bytes: ArrayBuffer } };
  nodes: { key: string; value: StudyNode; indexes: { byDoc: string } };
}

let dbPromise: Promise<IDBPDatabase<StudyDB>> | null = null;

function db() {
  dbPromise ??= openDB<StudyDB>("studytree", 1, {
    upgrade(d) {
      d.createObjectStore("docs", { keyPath: "id" });
      d.createObjectStore("files", { keyPath: "id" });
      const nodes = d.createObjectStore("nodes", { keyPath: "id" });
      nodes.createIndex("byDoc", "docId");
    },
  });
  return dbPromise;
}

export async function listDocs(): Promise<DocMeta[]> {
  const all = await (await db()).getAll("docs");
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDoc(id: string): Promise<DocMeta | undefined> {
  return (await db()).get("docs", id);
}

export async function putDoc(doc: DocMeta): Promise<void> {
  await (await db()).put("docs", doc);
}

export async function getFile(id: string): Promise<ArrayBuffer | undefined> {
  return (await (await db()).get("files", id))?.bytes;
}

export async function putFile(id: string, bytes: ArrayBuffer): Promise<void> {
  await (await db()).put("files", { id, bytes });
}

export async function getNodes(docId: string): Promise<StudyNode[]> {
  return (await db()).getAllFromIndex("nodes", "byDoc", docId);
}

export async function putNodes(nodes: StudyNode[]): Promise<void> {
  const tx = (await db()).transaction("nodes", "readwrite");
  await Promise.all([...nodes.map((n) => tx.store.put(n)), tx.done]);
}

export async function deleteNodes(ids: string[]): Promise<void> {
  const tx = (await db()).transaction("nodes", "readwrite");
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

export async function deleteDoc(id: string): Promise<void> {
  const d = await db();
  const ids = await d.getAllKeysFromIndex("nodes", "byDoc", id);
  const tx = d.transaction(["docs", "files", "nodes"], "readwrite");
  await Promise.all([
    tx.objectStore("docs").delete(id),
    tx.objectStore("files").delete(id),
    ...ids.map((k) => tx.objectStore("nodes").delete(k)),
    tx.done,
  ]);
}
