import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";

/**
 * Retrieves the duration (in seconds) of a remote or local MP4 video.
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
 * Merges multiple video clips using FFmpeg.
 * @param {Array<{ url: string, duration: number }>} videos - Array of valid video objects.
 * @param {string} outputPath - The temporary output file path.
 * @returns {Promise<void>}
 */
export async function mergeVideos(
  videos: Array<{ url: string; duration: number }>,
  outputPath: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let ffmpegChain = ffmpeg();
    videos.forEach((clip) => {
      ffmpegChain = ffmpegChain.input(clip.url);
    });
    ffmpegChain
      .complexFilter([
        { filter: "concat", options: { n: videos.length, v: 1, a: 0 } },
      ])
      .on("start", (cmd) => {
        // You can replace this with your logger if needed
        console.info(`[mergeVideos] FFmpeg merge started: ${cmd}`);
      })
      .on("error", (err) => {
        console.error(`[mergeVideos] Error: ${err}`);
        reject(err);
      })
      .on("end", () => {
        console.info("[mergeVideos] Merge completed successfully.");
        resolve();
      })
      .save(outputPath);
  });
}

/**
 * Overlays an audio track onto a video using FFmpeg.
 * @param {string} videoPath - The path of the video file.
 * @param {string} audioUrl - The URL of the audio track.
 * @param {string} outputPath - The final output file path.
 * @returns {Promise<void>}
 */
export async function addAudioToVideo(
  videoPath: string,
  audioUrl: string,
  outputPath: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioUrl)
      .videoCodec("copy")
      .audioCodec("aac")
      .on("start", (cmd) => {
        // You can replace this with your logger if needed
        console.info(`[addAudioToVideo] FFmpeg audio merge started: ${cmd}`);
      })
      .on("error", (err) => {
        console.error(`[addAudioToVideo] Error: ${err}`);
        reject(err);
      })
      .on("end", () => {
        console.info("[addAudioToVideo] Audio merge completed successfully.");
        resolve();
      })
      .save(outputPath);
  });
}

/**
 * Compiles a full music video by merging video clips and adding audio.
 * @param {string[]} videoUrls - Array of video URLs to merge.
 * @param {string} audioUrl - The URL of the audio track (song).
 * @returns {Promise<string>} - The local path of the final compiled video.
 */
export async function compileMusicVideo(
  videoUrls: string[],
  audioUrl: string
): Promise<string> {
  // Step 1: Get valid videos with durations
  const validVideos = await Promise.all(
    videoUrls.map(async (url) => {
      try {
        const duration = await getVideoDuration(url);
        return { url, duration };
      } catch (err) {
        console.warn(
          `[compileMusicVideo] Skipping ${url}, failed to retrieve duration: ${err}`
        );
        return null;
      }
    })
  );
  const filteredVideos = validVideos.filter(
    (v): v is { url: string; duration: number } => v !== null
  );
  if (filteredVideos.length === 0) {
    throw new Error("No valid videos with durations were found.");
  }

  // Step 2: Merge videos using FFmpeg
  const tempOutputPath = path.join(
    "/tmp",
    `final_compilation_${Date.now()}.mp4`
  );
  await mergeVideos(filteredVideos, tempOutputPath);

  // Step 3: Add audio to the merged video
  const finalOutputPath = path.join(
    "/tmp",
    `final_with_audio_${Date.now()}.mp4`
  );
  await addAudioToVideo(tempOutputPath, audioUrl, finalOutputPath);

  // Step 4: Return the local path of the final video (do not upload to IPFS here)
  fs.unlinkSync(tempOutputPath);
  return finalOutputPath;
}
