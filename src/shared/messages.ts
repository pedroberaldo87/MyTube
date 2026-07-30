import type { MessageResponse, MessageType } from './types'

export function sendMessage<T extends MessageType>(
  message: T
): Promise<MessageResponse<T['type']>> {
  return chrome.runtime.sendMessage(message)
}
