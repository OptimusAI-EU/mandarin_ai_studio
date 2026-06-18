function categorizeModel(model) {
  const id = (model.id || "").toLowerCase();
  const modalities = [];

  // Image models
  if (id.includes("image") || id.includes("img") || id.includes("dall-e") || id.includes("flux") || id.includes("stable-diffusion") || id.includes("sdxl") || id.includes("midjourney") || id.includes("imagen")) {
    modalities.push("image");
  }

  // Video models
  if (id.includes("video") || id.includes("veo") || id.includes("kling") || id.includes("seedance") || id.includes("sora") || id.includes("wan") || id.includes("hailuo") || id.includes("runway")) {
    modalities.push("video");
  }

  // Audio models (TTS, STT, voice)
  if (id.includes("tts") || id.includes("stt") || id.includes("speech") || id.includes("audio") || id.includes("voice") || id.includes("whisper") || id.includes("eleven") || id.includes("bark") || id.includes("xtts")) {
    modalities.push("audio");
  }

  // 3D models
  if (id.includes("3d") || id.includes("mesh") || id.includes("gaussian") || id.includes("nerf")) {
    modalities.push("3d");
  }

  // Default: if no modality detected, check context_length (LLM) or skip
  if (modalities.length === 0) {
    // Check if it has image generation capabilities via OpenRouter modality endpoint info
    const inputModalities = model.input_modalities || model.architecture?.input_modalities || [];
    const outputModalities = model.output_modalities || model.architecture?.output_modalities || [];
    if (inputModalities.includes("image") || outputModalities.includes("image")) modalities.push("image");
    if (inputModalities.includes("video") || outputModalities.includes("video")) modalities.push("video");
    if (inputModalities.includes("audio") || outputModalities.includes("audio")) modalities.push("audio");
  }

  // If still no modality, don't include it (it is likely a text-only LLM)
  return modalities;
}

function parseAllModels(models) {
  const result = { image: [], video: [], audio: [], "3d": [] };
  for (const model of models) {
    const modalities = categorizeModel(model);
    for (const mod of modalities) {
      if (result[mod]) result[mod].push({ ...model, modality: mod });
    }
  }
  return result;
}

module.exports = { categorizeModel, parseAllModels };
