import path from "path";

/**
 * Where Jarvis keeps its data. Normally ./data (git-ignored). JARVIS_DATA points elsewhere: the live demo
 * uses the bundled read-only ./demo folder, and tests use a temporary folder.
 */
export const dataDir = () => path.resolve(process.env.JARVIS_DATA || path.join(process.cwd(), "data"));

/** The public live demo (read-only sample data, sample answers, no PC control). */
export const isDemo = () => process.env.NEXT_PUBLIC_DEMO === "1";
