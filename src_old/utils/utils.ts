import { logger } from "../logger/logger";
import ffmpeg from "fluent-ffmpeg";

/**
 * Retrieves the duration (in seconds) of a remote or local MP4 video.
 *
 * @param {string} videoUrl - The URL (or local path) of the .mp4 file.
 * @returns {Promise<number>} - Resolves with the video duration in seconds.
 */
export async function getVideoDuration(videoUrl: string): Promise<number> {
  if (videoUrl === "") return 0;
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoUrl, (err, metadata) => {
      if (err) {
        return reject(
          new Error(`FFprobe failed for ${videoUrl}: ${err.message}`)
        );
      }
      // The duration is typically in metadata.format.duration
      const duration = metadata?.format?.duration || 0;
      resolve(duration);
    });
  });
}

/**
 * Checks if the current step already has required metadata (lyrics, title, tags).
 * @param step - The step object from the payments API.
 * @returns True if song metadata is present, false otherwise.
 */
export function hasSongMetadata(step: any): boolean {
  if (!step.input_artifacts) return false;
  try {
    if (Array.isArray(step.input_artifacts) && step.input_artifacts[0]) {
      return !!(
        step.input_artifacts[0].lyrics &&
        step.input_artifacts[0].title &&
        step.input_artifacts[0].tags
      );
    }
  } catch {
    logger.error(
      `Could not parse input_artifacts as JSON: ${step.input_artifacts}`
    );
  }
  return false;
}
