/**
 * Orchestrates the music video creation workflow.
 * @module orchestrator
 */

import { fetchAgentCard, sendTask } from "./agents/a2aAgentClient";
import { llmMapAgentParams, llmExtractImageUrl } from "./utils/llmA2aExtractor";
import {
  extractCharacters,
  extractSettings,
  extractScenes,
} from "./utils/a2aResultExtractor";
import { Logger } from "./utils/logger";

/**
 * Structure for storing generated images
 */
interface GeneratedImageAssets {
  characters: Map<string, string>; // character name -> image URL
  settings: Map<string, string>; // setting name -> image URL
}

/**
 * Starts the orchestration process for a music video.
 * @param {object} input - The input data (e.g. { prompt: string })
 * @returns {Promise<any>} - The result of the workflow.
 */
export async function startOrchestration(input: {
  prompt: string;
}): Promise<any> {
  Logger.info(
    "[startOrchestration] Starting music video orchestration process"
  );

  // Step 1: Fetch the agent card from the song-generator-agent
  const songAgentCard = await fetchAgentCard("http://localhost:8001");
  Logger.info("[startOrchestration] Fetched song agent card");

  // Step 2: Map the input to the agent's expected parameters using the LLM
  const mappedParams = await llmMapAgentParams({
    agentCard: songAgentCard,
    availableData: input,
  });

  // Step 3: Send the task to the song-generator-agent using SSE
  Logger.info("[startOrchestration] Sending task to song generator agent");
  const songResult = await sendTask(
    "http://localhost:8001",
    mappedParams,
    songAgentCard
  );
  Logger.info("[startOrchestration] Received song generation result");

  // Step 4: Fetch the agent card from the script-generator-agent
  const scriptAgentCard = await fetchAgentCard("http://localhost:8002");
  Logger.info("[startOrchestration] Fetched script agent card");

  // Step 5: Map the input, song result and collected data for the script generator
  const mappedScriptParams = await llmMapAgentParams({
    agentCard: scriptAgentCard,
    availableData: {
      ...input,
      songResult,
    },
  });

  // Step 6: Send the task to the script-generator-agent using SSE
  Logger.info("[startOrchestration] Sending task to script generator agent");
  const scriptResult = await sendTask(
    "http://localhost:8002",
    mappedScriptParams,
    scriptAgentCard
  );
  Logger.info("[startOrchestration] Received script generation result");

  // Step 7: Extract characters, settings, and scenes from script result
  Logger.info(
    "[startOrchestration] Extracting characters, settings, and scenes from script result"
  );

  const [characters, settings, scenes] = await Promise.all([
    extractCharacters(scriptAgentCard, scriptResult),
    extractSettings(scriptAgentCard, scriptResult),
    extractScenes(scriptAgentCard, scriptResult),
  ]);

  Logger.info(
    `[startOrchestration] Extracted ${characters.length} characters, ${settings.length} settings, and ${scenes.length} scenes`
  );

  // Step 8: Fetch the agent card from the image/video-generator-agent
  const mediaAgentCard = await fetchAgentCard("http://localhost:8003");
  Logger.info("[startOrchestration] Fetched image/video agent card");

  // Step 9: Generate images for all characters and settings
  Logger.info(
    "[startOrchestration] Generating images for characters and settings"
  );
  const generatedImages = await generateCharacterAndSettingImages(
    mediaAgentCard,
    characters,
    settings
  );
  Logger.info(
    `[startOrchestration] Generated ${generatedImages.characters.size} character images and ${generatedImages.settings.size} setting images`
  );

  // Step 10: Generate video clips for each scene
  // Logger.info("[startOrchestration] Generating video clips for each scene");
  // const videoClips = await generateVideoClips(
  //   mediaAgentCard,
  //   scenes,
  //   generatedImages,
  //   songResult
  // );
  // Logger.info(
  //   `[startOrchestration] Generated ${videoClips.length} video clips`
  // );

  // Return the complete result with extracted data and generated media
  return {
    songResult,
    scriptResult,
    extractedData: {
      characters,
      settings,
      scenes,
    },
    generatedMedia: {
      characterImages: Object.fromEntries(generatedImages.characters),
      settingImages: Object.fromEntries(generatedImages.settings),
      // videoClips,
    },
  };
}

/**
 * Generates an image for a character using the media generator agent.
 * @param {any} mediaAgentCard - The agent card for the image/video generator.
 * @param {any} character - The character object.
 * @returns {Promise<{ name: string, imageUrl: string }>} - The character name and generated image URL.
 */
async function generateCharacterImage(
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
async function generateSettingImage(
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
async function generateCharacterAndSettingImages(
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
 * @param {any} songResult - The result from the song generator.
 * @returns {Promise<any[]>} - Array of generated video clips with their details.
 */
export async function generateVideoClips(
  mediaAgentCard: any,
  scenes: any[],
  generatedImages: GeneratedImageAssets,
  songResult: any
): Promise<any[]> {
  const videoClips: any[] = [];

  for (const scene of scenes) {
    try {
      // Identify which characters are in this scene
      const sceneCharacters = scene.characters || [];
      const sceneCharacterImages: Record<string, string> = {};

      // Collect image URLs for characters in this scene
      if (Array.isArray(sceneCharacters)) {
        for (const charName of sceneCharacters) {
          if (generatedImages.characters.has(charName)) {
            sceneCharacterImages[charName] =
              generatedImages.characters.get(charName)!;
          }
        }
      }

      // Get the setting image for this scene
      const settingName = scene.setting || "";
      const settingImage = generatedImages.settings.get(settingName) || "";

      // Create the video generation parameters
      const params = await llmMapAgentParams({
        agentCard: mediaAgentCard,
        availableData: {
          intent: "generate_video",
          scene: scene,
          sceneNumber: scene.sceneNumber,
          prompt: scene.prompt || `Scene of ${scene.description}`,
          settingImage,
          settingName,
          characterImages: sceneCharacterImages,
          songInfo: {
            title: songResult?.title || "",
            audioUrl: songResult?.audioUrl || "",
            duration: songResult?.duration || 0,
          },
          // Additional video parameters
          duration: scene.duration || 5, // default 5 seconds per scene if not specified
          description: scene.description || "",
        },
      });

      // Call the video generator agent for this scene
      Logger.info(
        `[generateVideoClips] Generating video for scene ${
          scene.sceneNumber
        }: ${scene.description?.substring(0, 50)}...`
      );
      const result = await sendTask(
        "http://localhost:8003",
        params,
        mediaAgentCard
      );

      // Extract video URL and details from result
      let videoUrl = "";
      let videoDetails: any = {};

      if (result && result.artifacts && result.artifacts.length > 0) {
        for (const artifact of result.artifacts) {
          for (const part of artifact.parts || []) {
            if (part.type === "text" && part.text) {
              try {
                const content = JSON.parse(part.text);
                if (content.videoUrl) {
                  videoUrl = content.videoUrl;
                  videoDetails = content;
                  break;
                }
              } catch (e) {
                // Not JSON or doesn't contain videoUrl
                continue;
              }
            } else if (part.type === "file" && part.file && part.file.uri) {
              videoUrl = part.file.uri;
              videoDetails = { videoUrl };
              break;
            }
          }
          if (videoUrl) break;
        }
      }

      if (videoUrl) {
        // Create a video clip object with all relevant information
        const videoClip = {
          sceneNumber: scene.sceneNumber,
          description: scene.description,
          videoUrl,
          duration: videoDetails.duration || scene.duration || 5,
          startTime: scene.startTime,
          endTime: scene.endTime,
          characters: sceneCharacters,
          setting: settingName,
          ...videoDetails,
        };

        videoClips.push(videoClip);
        Logger.info(
          `[generateVideoClips] Successfully generated video for scene ${scene.sceneNumber}`
        );
      } else {
        Logger.warn(
          `[generateVideoClips] Failed to extract video URL for scene ${scene.sceneNumber}`
        );
      }
    } catch (error) {
      Logger.error(
        `[generateVideoClips] Error generating video for scene ${scene.sceneNumber}:`,
        error
      );
    }
  }

  // Sort video clips by scene number to maintain narrative order
  videoClips.sort((a, b) => (a.sceneNumber || 0) - (b.sceneNumber || 0));

  return videoClips;
}
