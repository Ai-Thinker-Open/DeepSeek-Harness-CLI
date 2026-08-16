// Optional audio layer for the animated logo.
//
// The visual shimmer / mouse-ripple animation is fully implemented. Sound is
// intentionally a no-op in this phase because playback requires bundling wav
// assets plus a system audio player, which would add fragile dependencies.
// The API matches MiMo Code's sound util so audio can be wired later without
// touching the Logo component.
export const Sound = {
  start() {},
  stop() {},
  pulse() {},
  dispose() {},
}
