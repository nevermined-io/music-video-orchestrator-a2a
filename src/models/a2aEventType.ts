/**
 * @file a2aEventType.ts
 * @description Unified enum for A2A event types (SSE and push notifications)
 */

/**
 * @enum A2AEventType
 * @description Types of events that can be sent via SSE or push notifications in A2A protocol
 */
export enum A2AEventType {
  STATUS_UPDATE = "status_update",
  ARTIFACT = "artifact",
  ERROR = "error",
  COMPLETION = "completion",
}
