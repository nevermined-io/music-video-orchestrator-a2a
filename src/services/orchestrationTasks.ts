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
 * @returns {Promise<{ name: string, imageUrl: string }>} - The character name and generated image URL.
 */
export async function generateCharacterImage(
  mediaAgentCard: any,
  character: any
): Promise<{ name: string; imageUrl: string }> {
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
  return { name: character.name, imageUrl: imageUrl || "" };
}

/**
 * Generates an image for a setting using the media generator agent.
 * @param {any} mediaAgentCard - The agent card for the image/video generator.
 * @param {any} setting - The setting object.
 * @returns {Promise<{ name: string, imageUrl: string }>} - The setting name and generated image URL.
 */
export async function generateSettingImage(
  mediaAgentCard: any,
  setting: any
): Promise<{ name: string; imageUrl: string }> {
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
  return { name: setting.name, imageUrl: imageUrl || "" };
}

/**
 * Generates images for all characters and settings using the media generator agent.
 * @param {any} mediaAgentCard - The agent card for the image/video generator.
 * @param {any[]} characters - Array of character objects.
 * @param {any[]} settings - Array of setting objects.
 * @returns {Promise<{ characters: Map<string, string>, settings: Map<string, string> }>} - Map of generated images for characters and settings.
 */
export async function generateCharacterAndSettingImages(
  mediaAgentCard: any,
  characters: any[],
  settings: any[]
): Promise<{ characters: Map<string, string>; settings: Map<string, string> }> {
  const characterImages = new Map<string, string>();
  const settingImages = new Map<string, string>();
  const characterImageResults = await Promise.all(
    characters.map((character) =>
      generateCharacterImage(mediaAgentCard, character)
    )
  );
  const settingImageResults = await Promise.all(
    settings.map((setting) => generateSettingImage(mediaAgentCard, setting))
  );
  for (const { name, imageUrl } of characterImageResults) {
    if (imageUrl) characterImages.set(name, imageUrl);
  }
  for (const { name, imageUrl } of settingImageResults) {
    if (imageUrl) settingImages.set(name, imageUrl);
  }
  return { characters: characterImages, settings: settingImages };
}

/**
 * Generates video clips for each scene using the video generator agent.
 * @param {any} mediaAgentCard - The agent card for the image/video generator.
 * @param {any[]} scenes - Array of scene objects.
 * @param {{ characters: Map<string, string>, settings: Map<string, string> }} generatedImages - Map of generated images for characters and settings.
 * @returns {Promise<any[]>} - Array of generated video clips with their details.
 */
export async function generateVideoClips(
  mediaAgentCard: any,
  scenes: any[],
  generatedImages: {
    characters: Map<string, string>;
    settings: Map<string, string>;
  }
): Promise<any[]> {
  async function processScene(scene: any): Promise<string | null> {
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
    return videoUrl || null;
  }
  const videoClipResults = await Promise.all(
    scenes.slice(0, 1).map((scene) => processScene(scene)) //TODO: Remove slice
  );
  return videoClipResults.filter((url) => !!url);
}
