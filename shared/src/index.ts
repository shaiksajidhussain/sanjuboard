export { analyzeDiagram, type DiagramIssue } from "./analyze";
export {
  applyIfUnchanged,
  commitScene,
  conversionClosure,
  mutatingChanges,
  restoreSnapshot,
  type Mutation,
  type SnapshotEntry,
  restoreScene,
  sceneSignature,
  validateProposal,
} from "./apply";
export {
  assistantSystemPrompt,
  assistantUserPrompt,
  extractJson,
  interpretModelOutput,
  requestProposal,
  type AssistantResult,
} from "./assistant";
export { localAssistant, planLocally, type AssistantInput } from "./planner";
export { blueprintForPrompt, blueprintOperations } from "./blueprints";
export {
  isModeledElementType,
  modelResponseSchema,
  operationSchema,
  proposeRequestSchema,
  sceneNodeSchema,
  normalizeModelPayload,
  summarizeCanvas,
  type CanvasElement,
  type Change,
  type DiagramOperation,
  type Proposal,
  type ProposeRequest,
  type SceneNode,
} from "./schema";
