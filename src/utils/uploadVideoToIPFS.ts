import fs from "fs";
const pinataSDK = require("@pinata/sdk");
import { logger } from "../logger/logger";

import { PINATA_API_KEY, PINATA_API_SECRET } from "../config/env";

const pinata = new pinataSDK({
  pinataApiKey: PINATA_API_KEY,
  pinataSecretApiKey: PINATA_API_SECRET,
});

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
    logger.info(`File uploaded to Pinata: ${cid}`);

    const fileUrl = `https://gateway.pinata.cloud/ipfs/${cid}`;

    logger.info(`File available at: ${fileUrl}`);
    return fileUrl;
  } catch (error) {
    logger.error(`Error uploading file to Pinata: ${JSON.stringify(error)}`);
    throw error;
  }
}
