import {
  llmMapAgentParams,
  llmExtractImageUrl,
  llmExtractVideoUrl,
} from "../agents/llmA2aExtractor";
import { Logger } from "../core/logger";
import { sendTask } from "../agents/a2aAgentClient";

/**
 * Structure for storing generated images
 */
export interface GeneratedImageAssets {
  characters: Map<string, string>; // character name -> image URL
  settings: Map<string, string>; // setting name -> image URL
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
  try {
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

    Logger.info(
      `[generateCharacterImage] Generating image for character: ${character.name}`
    );
    const result = await sendTask(
      "http://localhost:8003",
      params,
      mediaAgentCard
    );

    const imageUrl = await llmExtractImageUrl(mediaAgentCard, result);

    if (imageUrl) {
      Logger.info(
        `[generateCharacterImage] Successfully generated image for character: ${character.name}`
      );
      return { name: character.name, imageUrl };
    } else {
      Logger.warn(
        `[generateCharacterImage] Failed to extract image URL for character: ${character.name}`
      );
      return { name: character.name, imageUrl: "" };
    }
  } catch (error) {
    Logger.error(
      `[generateCharacterImage] Error generating image for character ${character.name}:`,
      error
    );
    return { name: character.name, imageUrl: "" };
  }
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
  try {
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

    Logger.info(
      `[generateSettingImage] Generating image for setting: ${setting.name}`
    );
    const result = await sendTask(
      "http://localhost:8003",
      params,
      mediaAgentCard
    );

    const imageUrl = await llmExtractImageUrl(mediaAgentCard, result);

    if (imageUrl) {
      Logger.info(
        `[generateSettingImage] Successfully generated image for setting: ${setting.name}`
      );
      return { name: setting.name, imageUrl };
    } else {
      Logger.warn(
        `[generateSettingImage] Failed to extract image URL for setting: ${setting.name}`
      );
      return { name: setting.name, imageUrl: "" };
    }
  } catch (error) {
    Logger.error(
      `[generateSettingImage] Error generating image for setting ${setting.name}:`,
      error
    );
    return { name: setting.name, imageUrl: "" };
  }
}

/**
 * Generates images for all characters and settings using the media generator agent.
 * @param {any} mediaAgentCard - The agent card for the image/video generator.
 * @param {any[]} characters - Array of character objects.
 * @param {any[]} settings - Array of setting objects.
 * @returns {Promise<GeneratedImageAssets>} - Map of generated images for characters and settings.
 */
export async function generateCharacterAndSettingImages(
  mediaAgentCard: any,
  characters: any[],
  settings: any[]
): Promise<GeneratedImageAssets> {
  const characterImages = new Map<string, string>();
  const settingImages = new Map<string, string>();

  Logger.info(
    `[generateCharacterAndSettingImages] Generating images for ${characters.length} characters`
  );
  const characterImageResults = await Promise.all(
    characters.map((character) =>
      generateCharacterImage(mediaAgentCard, character)
    )
  );

  Logger.info(
    `[generateCharacterAndSettingImages] Generating images for ${settings.length} settings`
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
 * @param {GeneratedImageAssets} generatedImages - Map of generated images for characters and settings.
 * @returns {Promise<any[]>} - Array of generated video clips with their details.
 */
export async function generateVideoClips(
  mediaAgentCard: any,
  scenes: any[],
  generatedImages: GeneratedImageAssets
): Promise<any[]> {
  async function processScene(scene: any): Promise<string | null> {
    try {
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
        scene.visualPrompt ||
        `A cinematic shot of ${scene.description || "the scene"}`;

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
          intent: "generate_video",
        },
      });

      Logger.info(
        `[generateVideoClips] Generating video for scene: ${scene.sceneNumber}`
      );
      const result = await sendTask(
        "http://localhost:8003",
        params,
        mediaAgentCard
      );

      const videoUrl = await llmExtractVideoUrl(mediaAgentCard, result);
      if (videoUrl) {
        Logger.info(
          `[generateVideoClips] Successfully generated video for scene: ${scene.sceneNumber}`
        );
        return videoUrl;
      } else {
        Logger.warn(
          `[generateVideoClips] Failed to extract video URL for scene: ${scene.sceneNumber}`
        );
        return null;
      }
    } catch (error) {
      Logger.error(
        `[generateVideoClips] Error generating video for scene ${scene.sceneNumber}:`,
        error
      );
      return null;
    }
  }

  const videoClipResults = await Promise.all(
    scenes.map((scene) => processScene(scene))
  );
  return videoClipResults.filter((url) => !!url);
}
