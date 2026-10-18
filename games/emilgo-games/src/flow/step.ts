// One step of a game's tutorial (flow/tutorial.ts plays them). Kept apart
// from the player so a game's script — and the server's tests — can use it
// without the page.

export interface TutorialStep {
  id: string;
  title: string;
  /** Spoken and captioned. */
  say: string;
  /** A CSS selector of something on screen to ring while this step shows. */
  hi?: string;
}
