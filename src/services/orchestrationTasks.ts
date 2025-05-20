/**
 * @file orchestrationTasks.ts
 * @description Orchestration helpers for all A2A agent calls (song, script, media)
 */

import {
  llmMapAgentParams,
  llmExtractSongInfo,
  llmExtractImageUrl,
  llmExtractVideoUrl,
} from "../agents/llmA2aExtractor";
import { sendTask } from "../agents/a2aAgentClient";
import { withRetry } from "../utils/retry";

/**
 * Generates a song using the song generator agent.
 * @param {any} songAgentCard - The agent card for the song generator.
 * @param {any} input - The input data (e.g. { prompt: string })
 * @returns {Promise<any>} - The result of the song generation.
 */
export async function generateSong(
  songAgentCard: any,
  input: any
): Promise<any> {
  const mappedParams = await llmMapAgentParams({
    agentCard: songAgentCard,
    availableData: input,
  });
  const songResult = await withRetry(
    () => sendTask("http://localhost:8001", mappedParams, songAgentCard),
    3,
    2000
  );
  const { songUrl, title } = await llmExtractSongInfo(
    songAgentCard,
    songResult
  );
  return { songResult, songUrl, title };
}

/**
 * Generates a script using the script generator agent.
 * @param {any} scriptAgentCard - The agent card for the script generator.
 * @param {any} input - The input data (e.g. { prompt: string })
 * @param {any} songResult - The result from the song generator.
 * @returns {Promise<any>} - The result of the script generation.
 */
export async function generateScript(
  scriptAgentCard: any,
  input: any,
  songResult: any
): Promise<any> {
  const mappedScriptParams = await llmMapAgentParams({
    agentCard: scriptAgentCard,
    availableData: {
      ...input,
      songResult,
    },
  });
  return await withRetry(
    () =>
      sendTask("http://localhost:8002", mappedScriptParams, scriptAgentCard),
    3,
    2000
  );
}

/**
 * Generates an image for a character using the media generator agent.
 * @param {any} mediaAgentCard - The agent card for the image/video generator.
 * @param {any} character - The character object.
 * @returns {Promise<{ name: string, imageUrl: string, artifact?: any }>} - The character name, generated image URL, and original artifact.
 */
export async function generateCharacterImage(
  mediaAgentCard: any,
  character: any
): Promise<{ name: string; imageUrl: string; artifact?: any }> {
  const characterPrompt =
    character.visualPrompt ||
    `Full body portrait of ${character.name}, ${character.description}, high quality, detailed, cinematic lighting`;
  const params = await llmMapAgentParams({
    agentCard: mediaAgentCard,
    availableData: {
      type: "character",
      name: character.name,
      prompt: characterPrompt,
      description: character.description,
      details: character,
      intent: "generate_image",
    },
  });
  const result = await withRetry(
    () => sendTask("http://localhost:8003", params, mediaAgentCard),
    3,
    2000
  );
  const imageUrl = await llmExtractImageUrl(mediaAgentCard, result);
  return {
    name: character.name,
    imageUrl: imageUrl || "",
    artifact: Array.isArray(result.artifacts) ? result.artifacts[0] : undefined,
  };
}

/**
 * Generates an image for a setting using the media generator agent.
 * @param {any} mediaAgentCard - The agent card for the image/video generator.
 * @param {any} setting - The setting object.
 * @returns {Promise<{ name: string, imageUrl: string, artifact?: any }>} - The setting name, generated image URL, and original artifact.
 */
export async function generateSettingImage(
  mediaAgentCard: any,
  setting: any
): Promise<{ name: string; imageUrl: string; artifact?: any }> {
  const settingPrompt =
    setting.imagePrompt ||
    `Wide shot of ${setting.name}, ${setting.description}, cinematic, high quality, detailed`;
  const params = await llmMapAgentParams({
    agentCard: mediaAgentCard,
    availableData: {
      type: "setting",
      name: setting.name,
      prompt: settingPrompt,
      description: setting.description,
      details: setting,
      intent: "generate_image",
    },
  });
  const result = await withRetry(
    () => sendTask("http://localhost:8003", params, mediaAgentCard),
    3,
    2000
  );
  const imageUrl = await llmExtractImageUrl(mediaAgentCard, result);
  return {
    name: setting.name,
    imageUrl: imageUrl || "",
    artifact: Array.isArray(result.artifacts) ? result.artifacts[0] : undefined,
  };
}

/**
 * Generates images for all characters and settings using the media generator agent.
 * @param {any} mediaAgentCard - The agent card for the image/video generator.
 * @param {any[]} characters - Array of character objects.
 * @param {any[]} settings - Array of setting objects.
 * @returns {Promise<{ characters: Map<string, string>, settings: Map<string, string>, rawCharacterArtifacts: any[], rawSettingArtifacts: any[] }>} - Maps and original artifacts.
 */
export async function generateCharacterAndSettingImages(
  mediaAgentCard: any,
  characters: any[],
  settings: any[]
): Promise<{
  characters: Map<string, string>;
  settings: Map<string, string>;
  rawCharacterArtifacts: any[];
  rawSettingArtifacts: any[];
}> {
  const characterImages = new Map<string, string>();
  const settingImages = new Map<string, string>();
  const characterImageResults = await Promise.all(
    characters.slice(0, 1).map(
      (
        character // TODO: Remove slice
      ) => generateCharacterImage(mediaAgentCard, character)
    )
  );
  const settingImageResults = await Promise.all(
    settings
      .slice(0, 1)
      .map((setting) => generateSettingImage(mediaAgentCard, setting)) // TODO: Remove slice
  );
  for (const { name, imageUrl } of characterImageResults) {
    if (imageUrl) characterImages.set(name, imageUrl);
  }
  for (const { name, imageUrl } of settingImageResults) {
    if (imageUrl) settingImages.set(name, imageUrl);
  }
  return {
    characters: characterImages,
    settings: settingImages,
    rawCharacterArtifacts: characterImageResults
      .map((r) => r.artifact)
      .filter(Boolean),
    rawSettingArtifacts: settingImageResults
      .map((r) => r.artifact)
      .filter(Boolean),
  };
}

/**
 * Generates video clips for each scene using the video generator agent.
 * @param {any} mediaAgentCard - The agent card for the image/video generator.
 * @param {any[]} scenes - Array of scene objects.
 * @param {{ characters: Map<string, string>, settings: Map<string, string> }} generatedImages - Map of generated images for characters and settings.
 * @returns {Promise<{ videoClips: string[], rawVideoArtifacts: any[] }>} - URLs and original artifacts.
 */
export async function generateVideoClips(
  mediaAgentCard: any,
  scenes: any[],
  generatedImages: {
    characters: Map<string, string>;
    settings: Map<string, string>;
  }
): Promise<{ videoClips: string[]; rawVideoArtifacts: any[] }> {
  async function processScene(
    scene: any
  ): Promise<{ url: string | null; artifact?: any }> {
    const sceneCharacters = scene.characters || [];
    const sceneCharacterImages: Record<string, string> = {};
    if (Array.isArray(sceneCharacters)) {
      for (const charName of sceneCharacters) {
        if (generatedImages.characters.has(charName)) {
          sceneCharacterImages[charName] =
            generatedImages.characters.get(charName)!;
        }
      }
    }
    const settingName = scene.setting || "";
    const settingImage =
      settingName && generatedImages.settings.has(settingName)
        ? generatedImages.settings.get(settingName)
        : "";
    const videoPrompt =
      scene.prompt || `A cinematic shot of ${scene.description || "the scene"}`;
    const params = await llmMapAgentParams({
      agentCard: mediaAgentCard,
      availableData: {
        type: "scene",
        sceneNumber: scene.sceneNumber,
        prompt: videoPrompt,
        description: scene.description,
        characters: sceneCharacters,
        characterImages: sceneCharacterImages,
        setting: settingName,
        settingImage,
        duration: scene.duration,
        intent: "generate_video",
      },
    });
    const result = await withRetry(
      () => sendTask("http://localhost:8003", params, mediaAgentCard),
      3,
      2000
    );
    const videoUrl = await llmExtractVideoUrl(mediaAgentCard, result);
    return {
      url: videoUrl || null,
      artifact: Array.isArray(result.artifacts)
        ? result.artifacts[0]
        : undefined,
    };
  }
  const videoClipResults = await Promise.all(
    scenes.slice(0, 1).map((scene) => processScene(scene)) // TODO: Remove slice
  );
  return {
    videoClips: videoClipResults.map((r) => r.url).filter(Boolean) as string[],
    rawVideoArtifacts: videoClipResults.map((r) => r.artifact).filter(Boolean),
  };
}
