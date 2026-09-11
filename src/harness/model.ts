/**
 * Whether a model accepts image input.
 *
 * The harness enforces this for real — `@deepseek-ai/dsh-llm-deepseek` rejects
 * image content for a model whose `inputModalities` excludes `image` — but it
 * does not publish that metadata to API clients. `session/modelCatalog` entries
 * carry only `id`/`name`/`description`/`reasoning`, and the `imageLimits`
 * projection is a static media-type list owned by the attachment store, not a
 * per-model capability. So the client has to decide from the model id/name, and
 * this module is the single place that decision lives.
 *
 * Two rules, in order:
 *  1. an explicit table of models dsh declares image-capable, matched
 *     case- and separator-insensitively so both the catalog id
 *     (`deepseek-flash`) and the display name (`DeepSeek-V41-Flash`) hit;
 *  2. a generic keyword heuristic (`vision`/`multimodal`/`omni`/`vl`) for
 *     models the table does not know.
 *
 * Anything unrecognized counts as text-only, which keeps the composer's warning
 * (rather than letting the harness reject the message after it is sent).
 */

/** Strip a `provider/` prefix, leaving the model id or display name. */
function baseModelName(value: string): string {
  const slash = value.lastIndexOf("/")
  return slash >= 0 ? value.slice(slash + 1) : value
}

/** Lowercase and drop separators so ids and display names compare equal. */
function normalizeModel(value: string): string {
  return value.toLowerCase().replace(/[\s._-]/g, "")
}

/**
 * Models dsh ships as `inputModalities: ["text", "image"]` in
 * `@deepseek-ai/dsh-llm-deepseek`'s `DEFAULT_MODELS`, keyed by normalized id and
 * display name. `deepseek-flash` is the v4.1 flash model, whose name
 * (`DeepSeek-V41-Flash`) carries no `vision` marker — the case this table
 * exists for. Add an entry here when dsh gains another image-capable model
 * without such a marker.
 */
const IMAGE_CAPABLE_MODELS = new Set([
  "deepseekflash", // id: deepseek-flash
  "deepseekv41flash", // name: DeepSeek-V41-Flash (also written deepseek-v4.1-flash)
  "deepseekv4flashvisionexp", // id/name: deepseek-v4-flash-vision-exp
])

/** Generic naming that marks a model as image-capable. */
const VISION_KEYWORDS = /(?:vision|multimodal|omni|vl)/i

/**
 * Whether `model` accepts image input.
 * @param model - harness-reported model id or display name; absent means unknown.
 */
export function modelSupportsImages(model: string | undefined): boolean {
  if (model === undefined) return false
  const base = baseModelName(model.trim())
  if (base === "") return false
  if (VISION_KEYWORDS.test(base)) return true
  return IMAGE_CAPABLE_MODELS.has(normalizeModel(base))
}
