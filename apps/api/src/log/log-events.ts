/** 7 个关键埋点事件名，集中定义避免裸写字符串。 */
export const LogEvent = {
  TaskCreated: 'task.created',
  TaskAnswered: 'task.answered',
  TaskTtsDone: 'task.tts.done',
  TaskRenderSubmitted: 'task.render.submitted',
  TaskRenderPolled: 'task.render.polled',
  TaskVideoReady: 'task.video.ready',
  TaskFailed: 'task.failed',
} as const;

export type LogEvent = (typeof LogEvent)[keyof typeof LogEvent];
