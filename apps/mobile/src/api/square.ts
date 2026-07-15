export type SquareComment = {
  id: string;
  postId: string;
  author: string;
  authorDevice: string;
  content: string;
  status: string;
  createdAt: string;
};

export type SquareReaction = { postId: string; account: string; kind: "like" | "insight" | "support"; active: boolean; updatedAt: string };
export type SquareFollow = { follower: string; following: string; active: boolean; updatedAt: string };
export type SquareReport = {
  id: string;
  reporter: string;
  targetType: "post" | "comment" | "account";
  targetId: string;
  category: string;
  detail: string;
  evidenceHashes?: string[];
  status: string;
  appealRoute: string;
  createdAt: string;
  updatedAt: string;
};

export function parseSquareComments(value: unknown): SquareComment[] {
  if (!isPlainObject(value) || !Array.isArray(value.comments)) throw new Error("Square comments returned an invalid payload");
  return value.comments.map(parseSquareComment);
}

export function parseSquareCommentResult(value: unknown): SquareComment { return parseResult(value, parseSquareComment, "comment"); }
export function parseSquareReactionResult(value: unknown): SquareReaction { return parseResult(value, parseSquareReaction, "reaction"); }
export function parseSquareFollowResult(value: unknown): SquareFollow { return parseResult(value, parseSquareFollow, "follow"); }
export function parseSquareReportResult(value: unknown): SquareReport { return parseResult(value, parseSquareReport, "report"); }

function parseSquareComment(value: unknown): SquareComment {
  if (!isPlainObject(value) || !strings(value, ["id", "postId", "author", "authorDevice", "content", "status", "createdAt"])) throw new Error("Square comment returned an invalid payload");
  return value as SquareComment;
}

function parseSquareReaction(value: unknown): SquareReaction {
  if (!isPlainObject(value) || !strings(value, ["postId", "account", "kind", "updatedAt"]) || !["like", "insight", "support"].includes(value.kind as string) || typeof value.active !== "boolean") throw new Error("Square reaction returned an invalid payload");
  return value as SquareReaction;
}

function parseSquareFollow(value: unknown): SquareFollow {
  if (!isPlainObject(value) || !strings(value, ["follower", "following", "updatedAt"]) || typeof value.active !== "boolean") throw new Error("Square follow returned an invalid payload");
  return value as SquareFollow;
}

function parseSquareReport(value: unknown): SquareReport {
  if (!isPlainObject(value) || !strings(value, ["id", "reporter", "targetType", "targetId", "category", "detail", "status", "appealRoute", "createdAt", "updatedAt"]) || !["post", "comment", "account"].includes(value.targetType as string)) throw new Error("Square report returned an invalid payload");
  if (value.evidenceHashes !== undefined && (!Array.isArray(value.evidenceHashes) || value.evidenceHashes.some((hash) => typeof hash !== "string"))) throw new Error("Square report evidence hashes are invalid");
  return value as SquareReport;
}

function parseResult<T>(value: unknown, parse: (record: unknown) => T, name: string): T {
  if (!isPlainObject(value) || typeof value.replayed !== "boolean") throw new Error(`Square ${name} result returned an invalid payload`);
  return parse(value.record);
}

function strings(value: Record<string, unknown>, keys: string[]): boolean { return keys.every((key) => typeof value[key] === "string"); }
function isPlainObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
