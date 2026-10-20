/** Wall-clock corrections are not time spent practising. Check before any read
 * or write can advance the last durable wall timestamp. */
export class ClockContinuity {
  constructor(private wall:number,private monotonic:number){}
  sample(wall:number,monotonic:number) {
    const wallDelta=wall-this.wall, monotonicDelta=monotonic-this.monotonic;
    this.wall=wall;this.monotonic=monotonic;
    return wallDelta<0||monotonicDelta<0||Math.abs(wallDelta-monotonicDelta)>1500;
  }
}
