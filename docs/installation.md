# Install and enable Meeting capabilities independently

Target: DeepSeek Harness `0.2.0-rc.2`. Each capability declares its own `dsh.bundle.patch` and can be added to a DSH profile separately. The combined `bundles/dsh-meeting` package remains available as a convenience composition.

## Profile and dependency order

Initialize a new Web-based profile to supply the DSH Session, Tools and Web services:

```sh
pnpm dlx @deepseek-ai/dsh@0.2.0-rc.2 --profile meeting --from-default-profile web --dump-default-config
```

Then add only the capabilities needed, in dependency order:

```sh
pnpm dlx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile meeting add ./packages/meeting-context
pnpm dlx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile meeting add ./packages/meeting-speaker
pnpm dlx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile meeting add @deepseek-ai/dsh-experimental-voice-input-bundle@0.2.0-rc.2
pnpm dlx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile meeting add ./packages/meeting-capture
pnpm dlx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile meeting add ./packages/meeting-ui
```

- **Context** works with Tools + Sessions and has no recording dependency.
- **Speaker** registers a service independently; native model files are optional until configured.
- **Capture** requires Context and the official SpeechToText provider `sensevoice-local`; it does **not** replace the official Voice Input Bundle. Speaker is optional at runtime.
- The **combined bundle** activates the three Meeting services together but still requires the official Voice Input Bundle.

Verify configuration composition (this check does not require a microphone or model):

```sh
pnpm dlx @deepseek-ai/dsh@0.2.0-rc.2 --profile meeting --dump-config
```

The printed configuration must include `meeting-context`, `meeting-speaker`, `speech-to-text`, `speech-to-text-sensevoice`, and `meeting-capture`. Do not confuse bundle registration with an end-to-end working microphone; browser→Host transport is a later milestone.

## Workspace storage and privacy

Recordings stay in the Session Workspace, at:

```text
<Session Workspace>/.dsh-meeting/<sha256(sessionId)>/state.json
<Session Workspace>/.dsh-meeting/<sha256(sessionId)>/audio/000000.wav
```

The mapping hashes the opaque DSH Session ID for safe cross-platform file paths; `state.json` retains the original ID and checks it on read. A safe ignore rule is created non-destructively in each hashed Session directory. A missing `.dsh-meeting/.gitignore` is also created, but an existing user-maintained root ignore file is **never overwritten**. Ordinary Git adds exclude transcript and WAV files under a protected Session directory; a pre-existing unsafe Session-level ignore file causes the recorder to fail closed. Forced Git adds and non-Git syncing remain the user's responsibility. 

If `Session.header.cwd` is absent, the fallback Workspace is the Host process's current working directory, as in the DSH no-cwd shell default. This is still a Workspace, **never DSH_HOME**.

Workspace confinement is checked against canonical filesystem paths. Existing symlinks that lead the meeting root, Session directory, audio directory, or state file outside the selected Session Workspace are rejected rather than silently followed. There is no migration of recordings into DSH_HOME.

## Meeting Sidebar P0
The new Meeting tab is contributed through DSH's official right Sidebar Slot. Its Start/Stop controls capture Windows x64 **system playback** using `loopback-capture@3.0.2` WASAPI, not a browser microphone. Markdown transcript and summary remain inside the Session Workspace. Auto summary defaults to 15 minutes and uses the live Session's own LLM route only when its Agent is idle. Native Windows verification remains required.
