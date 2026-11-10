export type CharacterStatus = "idle" | "thinking" | "queued" | "creating" | "executing" | "input" | "confirmation" | "resume" | "uncertain";
export type DialogueKind = Exclude<CharacterStatus, "idle"> | "success" | "creative_success" | "failure";
export interface CharacterSpeech {
  readonly id: string;
  readonly text: string;
  readonly duration: 4000 | 6000;
}

const LINES: Record<DialogueKind, readonly [string, string, string]> = {
  thinking: ["让我理一理思路。", "我来想想，怎样更合适。", "稍等，我整理一下想法。"],
  queued: ["这份任务还在排队。", "任务排好队啦，等它开始。", "还在队列里，我陪你等一会儿。"],
  creating: ["我来把这一版做出来。", "开始动手，把想法变成作品。", "这一版交给我，正在制作啦。"],
  executing: ["我来处理这一步。", "任务开始啦，我在跟进。", "正在处理，结果出来再告诉你。"],
  input: ["还差一点资料，想请你补充。", "有个小空缺，需要你补一下。", "想继续这一步，还需要一点资料。"],
  confirmation: ["这一步，想听听你的选择。", "这一步等你点头，再继续。", "帮我确认一下，再继续吧。"],
  resume: ["这一程先停在这里，等你继续。", "准备继续时，点开看看吧。", "还有一步，等你来接着处理。"],
  uncertain: ["发送结果还没确认，点开看看吧。", "这次发送需要核对一下。", "我还没收到确认，一起看看对话吧。"],
  success: ["这一步完成啦，点开看看。", "事情办好啦，结果在这里。", "完成了，来看看结果吧。"],
  creative_success: ["做好啦，来看看这一版。", "新的一版好了，等你来看看。", "这一版完成啦，来瞧瞧吧。"],
  failure: ["这一步没完成，点开看看原因。", "这次没能完成，一起看看原因吧。", "遇到了一点问题，点开看看详情。"],
};

/** Variations advance only for a real event, never for polling or rendering. */
export class CharacterDialogue {
  private sequence = 0;
  private variants = new Map<DialogueKind, number>();

  say(kind: DialogueKind, text?: string): CharacterSpeech {
    const index = this.variants.get(kind) ?? 0;
    this.variants.set(kind, (index + 1) % LINES[kind].length);
    return {
      id: `speech:${++this.sequence}`,
      text: text ?? LINES[kind][index] ?? LINES[kind][0],
      duration: ["thinking", "queued", "creating", "executing"].includes(kind) ? 4000 : 6000,
    };
  }
}
