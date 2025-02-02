import { logger } from "../logger/logger";
import ffmpeg from "fluent-ffmpeg";

/**
 * Retrieves the duration (in seconds) of a remote or local MP4 video.
 *
 * @param {string} videoUrl - The URL (or local path) of the .mp4 file.
 * @returns {Promise<number>} - Resolves with the video duration in seconds.
 */
export async function getVideoDuration(videoUrl: string): Promise<number> {
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
    const artifacts = JSON.parse(step.input_artifacts);
    if (Array.isArray(artifacts) && artifacts[0]) {
      return !!(artifacts[0].lyrics && artifacts[0].title && artifacts[0].tags);
    }
  } catch {
    logger.warn("Could not parse input_artifacts as JSON");
  }
  return false;
}
