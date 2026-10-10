const PATHS: Record<string, string> = {
  back: "M15 18l-6-6 6-6",
  left: "M15 18l-6-6 6-6",
  right: "M9 18l6-6-6-6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  download: "M12 4v12M7 11l5 5 5-5M4 20h16",
  cursor: "M4 4l7 17 2.5-7.5L21 11z",
  region: "M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4",
  note: "M5 3h10l4 4v14H5zM15 3v4h4M9 12h6M9 16h4",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
  tree: "M12 3v5M12 8l-6 6M12 8l6 6M6 14v4M18 14v4M12 8v10",
  map: "M12 4a2 2 0 1 0 0 .01M6 14a2 2 0 1 0 0 .01M18 14a2 2 0 1 0 0 .01M12 6v3l-5 4M12 9l5 4M18 16v2M6 16v2",
  pin: "M12 17v5M8 3h8l-1 6 3 4H6l3-4z",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  branch: "M6 3v12M18 9a3 3 0 1 0 0-.01M6 21a3 3 0 1 0 0-.01M18 12c0 4-6 3-12 6",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  send: "M4 12l16-8-6 16-2.5-6.5z",
  stop: "M7 7h10v10H7z",
  close: "M6 6l12 12M18 6L6 18",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  sidebar: "M4 4h16v16H4zM9 4v16",
  sidebarR: "M4 4h16v16H4zM15 4v16",
  zoomIn: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6",
  zoomOut: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7",
  highlight: "M9 11l6-6 4 4-6 6zM9 11l-4 4v4h4l4-4M3 21h8",
  quiz: "M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V15M12 19h.01",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  collapse: "M8 14l4-4 4 4",
  expand: "M8 10l4 4 4-4",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
};

export function Icon({ name, size = 16, className = "" }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg
      className={`icon-svg ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? PATHS.file} />
    </svg>
  );
}
