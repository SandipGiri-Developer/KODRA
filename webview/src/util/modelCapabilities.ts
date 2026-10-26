// Utilities for determining model capabilities dynamically based on provider metadata.
import { ModelCapability, ModelDescription } from "core";

/**
 * Determines whether a given provider and model configuration supports image / multimodal inputs.
 * Strictly dynamic: relies directly on capability flags (uploadImage / vision) provided by the model metadata.
 */
export function modelSupportsImages(
  _provider?: string,
  _model?: string,
  _title?: string,
  capabilities?: ModelCapability | { vision?: boolean; uploadImage?: boolean },
): boolean {
  if (!capabilities) {
    return false;
  }
  if (typeof capabilities.uploadImage === "boolean") {
    return capabilities.uploadImage;
  }
  if (typeof (capabilities as any).vision === "boolean") {
    return Boolean((capabilities as any).vision);
  }
  return false;
}

/**
 * Determines whether a model supports reasoning or thinking mode.
 * Strictly dynamic: relies directly on model completionOptions or capability flags.
 */
export function modelSupportsReasoning(
  model: (ModelDescription & { capabilities?: { reasoning?: boolean } }) | null | undefined,
): boolean {
  if (!model) {
    return false;
  }
  if (typeof model.completionOptions?.reasoning === "boolean") {
    return model.completionOptions.reasoning;
  }
  if (typeof (model.capabilities as any)?.reasoning === "boolean") {
    return Boolean((model.capabilities as any).reasoning);
  }
  return false;
}
