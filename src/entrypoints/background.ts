import { browser } from 'wxt/browser';
import { createCommandHandler } from '../background/command-handler';
import { createGitHubClient } from '../github/client';
import {
  COMMAND_TYPES,
  commandFailure,
  createCommandError,
  type CommandResponse,
} from '../messaging/contracts';
import { createChromeStorageRepository } from '../storage/chrome-storage';

function isCommandMessage(message: unknown): boolean {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return false;
  }
  const type = (message as { type?: unknown }).type;
  return typeof type === 'string' && (COMMAND_TYPES as readonly string[]).includes(type);
}

function sendSafely(
  sendResponse: (response?: unknown) => void,
  response: CommandResponse,
): void {
  try {
    sendResponse(response);
  } catch {
    return;
  }
}

export default defineBackground(() => {
  const repository = createChromeStorageRepository();
  const github = createGitHubClient();
  const handler = createCommandHandler({ repository, github });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isCommandMessage(message)) {
      return false;
    }

    void handler.handle(message).then(
      (response) => {
        sendSafely(sendResponse, response);
      },
      () => {
        sendSafely(
          sendResponse,
          commandFailure(
            createCommandError('internal', 'An unexpected error occurred.'),
          ),
        );
      },
    );
    return true;
  });
});
