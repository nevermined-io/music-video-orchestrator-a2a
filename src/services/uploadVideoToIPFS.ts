import fs from "fs";
const pinataSDK = require("@pinata/sdk");
import { Logger } from "../core/logger";
import { PINATA_API_KEY, PINATA_API_SECRET } from "../config/env";

const pinata = new pinataSDK({
  pinataApiKey: PINATA_API_KEY,
  pinataSecretApiKey: PINATA_API_SECRET,
});

/**
 * Uploads a video file to IPFS using Pinata.
 * @param {string} filePath - The local path to the video file.
 * @param {string} fileName - The name to assign to the file on IPFS.
 * @returns {Promise<string>} - The public IPFS gateway URL of the uploaded file.
 */
export async function uploadVideoToIPFS(
  filePath: string,
  fileName: string
): Promise<string> {
  try {
    const fileStream = fs.createReadStream(filePath);
    const result = await pinata.pinFileToIPFS(fileStream, {
      pinataMetadata: {
        name: fileName,
      },
    });
    const cid = result.IpfsHash;
    Logger.info(`File uploaded to Pinata: ${cid}`);
    const fileUrl = `https://gateway.pinata.cloud/ipfs/${cid}`;
    Logger.info(`File available at: ${fileUrl}`);
    return fileUrl;
  } catch (error) {
    Logger.error(`Error uploading file to Pinata: ${JSON.stringify(error)}`);
    throw error;
  }
}
