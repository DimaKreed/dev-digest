export const DRAWER_WIDTH = 640;

/** Only these reach the server; the archive filter then admits .md only. */
export const ACCEPTED_EXTENSIONS = ".md,.markdown,.zip";

export const IMPORT_TABS = ["file", "url"] as const;
export type ImportTab = (typeof IMPORT_TABS)[number];
