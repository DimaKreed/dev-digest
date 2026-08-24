/* Fixed layout for the bipartite blast graph: three columns at fixed x, one row
   per node. Not a force simulation — the data is bipartite by construction and a
   settled physics layout would only make the same three columns harder to read. */

export const ROW_H = 40;
export const COL_SYMBOL = 20;
export const COL_CALLER = 300;
export const COL_ENDPOINT = 600;
export const BOX_W = 190;
export const BOX_H = 26;

/** Longer labels are elided, so a long endpoint cannot widen the whole column. */
export const MAX_LABEL_CHARS = 24;
