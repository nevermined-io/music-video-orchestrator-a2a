[![banner](https://raw.githubusercontent.com/nevermined-io/assets/main/images/logo/banner_logo.png)](https://nevermined.io)

Music Video Orchestrator Agent using Nevermined's Payments API (TypeScript)
===========================================================================

> A TypeScript-based orchestrator that generates complete music videos from a user prompt, leveraging the **Nevermined Payments API**. It coordinates multiple sub-agents (song generator, script generator, image/video generator), handles token swaps when necessary, and compiles everything into a final MP4 video.

* * *

Description
-----------

This project demonstrates how to build an **Orchestrator** that receives a creative brief for a music video (e.g., “A cyberpunk rap anthem about AI collaboration”), then proceeds through several steps to:

1.  **Generate a Song** (lyrics + audio track)
2.  **Generate a Script** (scenes, camera movements, character descriptions, settings)
3.  **Create Images** for each character and setting
4.  **Produce Short Video Clips** based on the generated prompts
5.  **Compile** the clips and audio track into a final music video (MP4)
6.  **Return** the final S3 URL for the video to the user

While orchestrating these tasks, the system also uses **Nevermined** to:

*   Validate **payment plans** for each agent (Song, Script, Video, etc.)
*   Automatically **swap** tokens if an agent requires payment in a currency different from the Orchestrator’s base token
*   **Log** events and results both locally and via the **Nevermined Payments** service

* * *

Table of Contents
-----------------

*   [Prerequisites](#prerequisites)
*   [Installation](#installation)
*   [Environment Variables](#environment-variables)
*   [Project Structure](#project-structure)
*   [Architecture and Workflow](#architecture-and-workflow)
*   [Usage](#usage)
*   [How It Works Internally](#how-it-works-internally)
*   [License](#license)

* * *

### Prerequisites

*   **Node.js** (>= 14 recommended)
*   **TypeScript** (project built on version 4.x or later)
*   Valid **Nevermined** credentials (API key, plan DIDs, agent DIDs, etc.)
*   Optional: A running **Ethereum node** or an RPC endpoint for swaps (if using Uniswap functionality)

### Installation

1.  **Clone** the repository:
    
    ```bash
    git clone https://github.com/nevermined-io/music-video-orchestrator-agent.git
    cd music-video-orchestrator-agent
    ```
    
2.  **Install** dependencies:
    
    ```bash
    npm install
    ```
    
3.  **Build** the project (optional step if you want the compiled JS):
    
    ```bash
    npm run build
    ```
    

### Environment Variables

Rename `.env.example` to `.env` and configure all relevant environment variables. Below is a sample of key variables you might need:

```makefile
# Nevermined
NVM_API_KEY=yourNeverminedApiKey
NVM_ENVIRONMENT=testing|base|staging|production

# Orchestrator’s DID
AGENT_DID=did:nv:1111aaaa-bbbb-cccc-dddd-orchestrator

# Agent DIDs
MUSIC_SCRIPT_GENERATOR_DID=did:nv:2222aaaa-music-script
SONG_GENERATOR_DID=did:nv:3333aaaa-song-gen
VIDEO_GENERATOR_DID=did:nv:4444aaaa-video-gen

# Plan DIDs
PLAN_DID=did:nv:7777aaaa-our-main-plan
SONG_GENERATOR_PLAN_DID=did:nv:8888aaaa-song-plan
MUSIC_SCRIPT_GENERATOR_PLAN_DID=did:nv:9999aaaa-script-plan
VIDEO_GENERATOR_PLAN_DID=did:nv:aaaa1111-video-plan

# AWS Config for uploading final video
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx

# Blockchain / Uniswap
RPC_URL=https://...
PRIVATE_KEY=0xYourPrivateKey
UNISWAP_V2_ROUTER_ADDRESS=0xUniswapRouter
UNISWAP_V2_FACTORY_ADDRESS=0xUniswapFactory
```

Each of these variables controls a part of the Orchestrator’s workflow, including Nevermined environment details, agent and plan DIDs, AWS credentials for S3 uploads, and the blockchain config for token swaps.

### Project Structure

```
.
├── config
│   └── env.ts               # Loads environment variables
├── logger
│   └── logger.ts            # Logger configuration using pino
├── payments
│   ├── blockchain.ts        # Handles token swaps & ERC20 logic
│   ├── ensureBalance.ts     # Checks if plan has enough credits; does swaps if needed
│   └── paymentsInstance.ts  # Initializes the Nevermined Payments library
├── steps
│   ├── stepHandlers.ts      # Main step logic (song/script/video generation + compilation)
│   └── taskValidation.ts    # Validates outputs of each task
├── utils
│   ├── logMessage.ts        # Log utility (local + remote)
│   └── utils.ts             # Helpers (e.g., FFmpeg usage)
├── main.ts                  # Entry point subscribing to "step-updated" events
├── package.json
├── README.md                # This file
├── tsconfig.json
├── .gitignore
└── .env
```

*   **`main.ts`**: Initializes the Orchestrator, listens for relevant events, and calls `processSteps()`.
*   **`stepHandlers.ts`**: Defines a handler function for each phase of the pipeline (`callSongGenerator`, `generateMusicScript`, `callImagesGenerator`, `callVideoGenerator`, `compileVideo`, etc.).
*   **`payments/blockchain.ts`**: Performs the actual Uniswap V2 swaps if an agent charges in a token we don’t currently hold.
*   **`payments/ensureBalance.ts`**: A utility that checks if we have enough credits for a plan, or triggers a purchase or swap if we’re short.
*   **`steps/taskValidation.ts`**: Once a sub-task (e.g., “Generate Song”) completes, we parse its output artifacts (like MP3 URL), ensuring correctness.

### Architecture and Workflow

1.  **Initial Step**
    
    *   A new user prompt arrives, creating an `init` step. The orchestrator spawns subsequent steps:
        1.  `callSongGenerator`
        2.  `generateMusicScript`
        3.  `callImagesGenerator`
        4.  `callVideoGenerator`
        5.  `compileVideo`
2.  **Song Generation** (`callSongGenerator`)
    
    *   Checks balance for `SONG_GENERATOR_PLAN_DID`.
    *   Swaps tokens if needed (e.g., from USDC to VIRTUAL).
    *   Calls the Song Generator to produce lyrics, title, tags, MP3 and duration.
3.  **Music Script** (`generateMusicScript`)
    
    *   Checks balance for `MUSIC_SCRIPT_GENERATOR_PLAN_DID` (in LARRY, for example).
    *   Generates a detailed script with camera movements, character lists, and environment prompts.
4.  **Images** (`callImagesGenerator`)
    
    *   Each character and setting from the script is given to the Image/Video Generator.
    *   The system concurrently requests images for each subject, storing URLs in the step’s artifacts.
5.  **Video** (`callVideoGenerator`)
    
    *   For each scene prompt, the system requests a short video clip.
    *   Again, it checks or swaps tokens if the plan is short on credits.
6.  **Compilation** (`compileVideo`)
    
    *   Merges all video clips with FFmpeg, applies the audio track, and uploads the final `.mp4` to S3.
    *   Returns the final video URL as the completion output.

### Usage

Once your environment is set up and dependencies are installed, run:

```bash
npm run build
npm start
```

The Orchestrator will:

1.  **Log in** to the Nevermined Payments API with your `NVM_API_KEY`.
2.  Subscribe to any `step-updated` events directed to your `AGENT_DID`.
3.  Whenever a new workflow step is triggered for your agent, it will route it to the correct function in `stepHandlers.ts`.
4.  **Automatically** handle token swaps, sub-task creation, and logging.
5.  **Produce** and store the final compiled music video in S3.

### How It Works Internally

*   **Nevermined Payment Plans**: Each agent has its own DID and plan. The orchestrator checks if there’s enough balance before creating a sub-task for that agent. If not, it orders more credits—potentially swapping tokens to match what the agent requires.
*   **Concurrent Tasks**: For image or video generation, the orchestrator can create tasks in parallel. This is especially handy when generating multiple scenes at once.
*   **FFmpeg Merging**: The final step stitches together all video clips (scene by scene) and lays the audio track on top. Temporary files reside in `/tmp` or a similar location; afterward, the result is uploaded to AWS S3.
*   **Logging**: The system logs each action both locally (via `pino`) and remotely (via `payments.query.logTask()`), making it easy to see errors, transaction hashes, or final file URLs.

* * *

License
-------

```
Apache License 2.0

Copyright 2025 Nevermined AG

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```