declare module "@mojs/core" {
  interface MotionItem {
    stop(): MotionItem;
  }
  interface Timeline extends MotionItem {
    add(...items: MotionItem[]): Timeline;
    play(): Timeline;
  }
  const mojs: {
    easing: {
      bezier(
        x1: number,
        y1: number,
        x2: number,
        y2: number,
      ): (progress: number) => number;
    };
    Shape: new (options: Record<string, unknown>) => MotionItem;
    Burst: new (options: Record<string, unknown>) => MotionItem;
    Html: new (options: Record<string, unknown>) => MotionItem;
    Timeline: new (options?: Record<string, unknown>) => Timeline;
  };
  export default mojs;
}
