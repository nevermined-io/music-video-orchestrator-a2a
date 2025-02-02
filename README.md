[![banner](https://raw.githubusercontent.com/nevermined-io/assets/main/images/logo/banner_logo.png)](https://nevermined.io)

# Music Video Orchestrator Agent using Nevermined's Payments API (TypeScript)

> A TypeScript-based orchestrator that generates music video clips from a user prompt, leveraging the Nevermined Payments API. It coordinates multiple sub-agents: a music video script generator, a prompt synthesizer (or OpenAI-based logic), a song generator, and a video generator.

---

## Description

This project illustrates how to build an **Orchestrator** that:
1. Receives a music video idea (prompt) and a music style.
2. Invokes a music video script generator agent to develop the idea and list characters/elements.
3. Synthesizes information (possibly using OpenAI) to obtain:
   - A song-generation prompt (20-50 words) including style, voice type, and theme.
   - A list of music-style tags.
   - A song title.
   - A list of video prompts (various camera shots).
   - The song lyrics.
   - The average duration for each shot (in seconds).
4. Invokes a song generator agent to produce the song, returning its URL, duration, title, and lyrics.
5. Invokes a video generator agent multiple times (one task per video prompt).
6. Combines the generated clips (randomly repeated if needed) to match the song duration, then merges the audio track, generating a final music video.
7. Returns the final music video URL (or file path) to the user.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Architecture](#architecture)
- [Usage](#usage)
- [License](#license)

### Prerequisites

- Node.js >= 14
- TypeScript
- Nevermined credentials (API key, plan DIDs, agent DIDs)

### Installation

```bash
git clone https://github.com/your-username/music-video-orchestrator-agent.git
cd music-video-orchestrator-agent
npm install
````

### Environment Variables

Rename `.env.example` to `.env` and set your environment variables:

```makefile
NVM_API_KEY=yourNeverminedApiKey
NVM_ENVIRONMENT=testing
AGENT_DID=did:nv:abc-orchestrator
MUSIC_SCRIPT_GENERATOR_DID=did:nv:abc-music-script
SONG_GENERATOR_DID=did:nv:abc-song-gen
VIDEO_GENERATOR_DID=did:nv:abc-video-gen
PLAN_DID=did:nv:planA
VIDEO_GENERATOR_PLAN_DID=did:nv:planB
```

### Architecture

The orchestrator manages a workflow of steps:

1.  `init`
2.  `generateMusicScript`
3.  `synthesizeInformation`
4.  `callSongGenerator`
5.  `callVideoGenerator`
6.  `compileVideo`

A final compiled music video is produced at the end.

### Usage

```bash
npm run build
npm start
```

The orchestrator will subscribe to Nevermined `step-updated` events for its `AGENT_DID` and process any incoming workflow steps.


* * *

License
-------

```
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
