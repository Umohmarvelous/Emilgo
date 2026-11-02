# EMILGO Games v4: the owner's brief, word for word (2 Nov 2026)

Three prompts pasted together, then the owner's answers after the concept pass.

## The brief


PROMPT 1

This is a major character, combat, and camera control upgrade for Emilgo Games. Read the existing 3D character models, animation systems, shooting/combat logic, and camera joystick code before making changes.

We are shifting the visual identity and core combat to mirror a high-end, Unreal Engine 5-developed AAA shooter (like Call of Duty), while maintaining our mobile performance budget. 

I want to take the visual fidelity of Emilgo Games to the absolute maximum. I want a cinematic, AAA-level experience that looks like it was built in Unreal Engine 5, but it MUST still run at 30fps on low-end Android phones (Tecno/Infinix) and in a web browser, using our current React Native + Expo + Three.js stack.

Since we cannot use Unreal Engine or true hardware Ray Tracing on mobile devices, I need you to act as a Lead Technical Artist and Graphics Engineer. Read the existing Three.js renderer, lighting setup, and asset pipeline in the codebase. 

Implement the following upgrades:

### 1. COD-STYLE TACTICAL CHARACTERS
- **Complete Character Overhaul:** Redesign the player models to look like tactical operators from Call of Duty. 
- **Full Body Coverage:** Every part of the character's body must be fully covered in tactical gear (helmets, balaclavas, tactical vests, gloves). 
- **Face:** Only the eyes and the bridge of the nose should be visible. The rest of the face must be hidden.
- **Materials:** Use high-quality PBR materials for kevlar, fabric, and metal. Add subtle dirt, wear-and-tear, and scratches to the gear to make them look battle-hardened.

### 2. REALISTIC ZOMBIES (Dead Streets Mode)
- Completely overhaul the zombie character models. They must look like terrifying, hyper-realistic zombies (reference World War Z or Resident Evil).
- Add rotting flesh textures, exposed bone, torn clothing, and realistic blood decals. 
- Ensure their animations (emerging from the ground, lunging, attacking) look cinematic and fluid.

### 3. FREE FOR ALL: CONVERT TO A SHOOTER
- **Weapons:** Players now spawn with or must pick up firearms (assault rifles, SMGs, shotguns). Keep melee combat as a backup, but make shooting the primary mechanic.
- **Gunplay Mechanics:** Implement realistic shooting physics — ADS (Aim Down Sights), recoil patterns, bullet spread, reload animations, and hit markers.
- **Keep the Objectives:** The shooting is added to the existing gameplay loop. Players still fight for the flag, survive the shrinking safe zone, and use vehicles. The addition of guns makes the fight for supremacy lethal.

### 4. THE "UNREAL ENGINE" LOOK
- Upgrade the character shaders and environmental lighting to mimic Unreal Engine 5. 
- **Volumetric Lighting:** Light must interact realistically with the tactical gear (e.g., helmet reflections).
- **Post-Processing:** Apply subtle depth of field (when aiming), HDR bloom on muzzle flashes, and cinematic color grading to make the realistic characters pop.

### 5. EXACT COD-STYLE LOOK JOYSTICK (CRITICAL FIX)
The current look/camera joystick feels wrong. You must rewrite the camera joystick code to perfectly replicate the Call of Duty Mobile camera mechanics:
- **Touch-Anywhere Look Area:** The player should not be forced to touch a specific circle to look around. Swiping anywhere on the right half of the screen (outside of UI buttons) should control the camera.
- **No Visible Joystick (Default):** The look joystick should be invisible by default (like COD). The player just swipes. (Add an option in settings to show a faint visual indicator if they want).
- **Dynamic Deadzone:** Implement COD's precise deadzone and acceleration curve. Small swipes = slow, precise aiming. Fast swipes = rapid 180-degree turns.
- **No Snap-Back:** The camera stays exactly where the player leaves it. No auto-centering.
- **Joystick Placement:** The movement joystick (left) stays fixed as a 1px white outline, but the camera control must act like a touchpad on the right side.

### YOUR TASK
1. Read the existing character and camera controller code.
2. Present a plan for how you will implement the new tactical models, the zombie redesign, the FFA shooting mechanics, and the exact COD camera swipe mechanics.
3. Once the plan is approved, write the code. Ensure all new 3D models are optimized with LODs so they still run at 30fps on low-end Tecno/Infinix phones.

Change the welcome screen
Re-structure the entire hud on the lobby and the screen before players start playing
Both game mode is about surviving the hardships so every items will now be changed to an extra armor, so the player picks up an item and they get stronger and more bigger, their body shape and style changes too they put on a new amour/suit a more fearful suit the more they find and pick items they become stronger giving them more advantage over other players. They become like monsters and giants.
Leave everything about the billboard and ads system intact infact add more billboards everywhere 

PROMPT 2

I am upgrading the visual fidelity and scale of Emilgo Games to the absolute maximum. We are entering "Max Mode" and completely overhauling the game's world. 

Read the existing Three.js renderer, lighting setup, and map generation code in the codebase. Then, execute a massive world-building and graphics upgrade. 

For this update, I am giving you total, unrestricted creative freedom. Do NOT stick to previous map design descriptions, structural constraints, or the Nigerian-style architectural limits we discussed in the past. We are going global and hyper-realistic. Take all the time you need in your processing to build this to perfection.

Here is your directive:

### 1. HYPER-REALISTIC WORLD & MASSIVE SCALE
- **Forget past map constraints:** You are no longer bound to the 400m x 400m limits or specific Nigerian city layouts. Increase the map sizes significantly to create vast, expansive, and highly detailed environments.
- **Hyper-Realism:** Design the environments to look entirely realistic, drawing from the best-looking AAA games (e.g., Unreal Engine 5 tech demos, Battlefield, Call of Duty: Modern Warfare). Think dense forests, realistic urban warfare zones, massive deserts, and complex, multi-level buildings.
- **Deep Research & Asset Integration:** Do deep research online. I want you to locate, integrate, and implement between 1,000+ free/open-source assets (from sites like Quixel Megascans, PolyHaven, Sketchfab, Kenney). Where assets do not exist, generate procedural assets via code (e.g., realistic foliage, rocks, debris).

### 2. CINEMATIC "MAX MODE" GRAPHICS (THREE.JS)
Since we are in React Native/Three.js, you must fake the Unreal Engine 5 look:
- **Fake Ray Tracing:** Implement Screen Space Reflections (SSR) on wet surfaces, glass, and metal. Use high-quality baked Global Illumination.
- **Cinematic Lighting:** Implement Volumetric Fog, God Rays, and aggressive Cascaded Shadow Maps (CSM) for dramatic, moody lighting.
- **PBR & Normal Mapping:** Upgrade all assets to use Physically Based Rendering (Albedo, Normal, Roughness, Metalness, AO). Use high-detail normal maps on low-poly meshes to fake millions of polygons.
- **Post-Processing:** Add a high-end post-processing stack: HDR Bloom, SSAO (Ambient Occlusion), Color Grading (LUTs), and subtle Film Grain / Chromatic Aberration during action.

### 3. THE NON-NEGOTIABLE RULE: MOBILE PERFORMANCE
You have creative freedom, but you MUST NOT break the 30fps floor on low-end Android devices (Tecno/Infinix) and web browsers. 
- **How to handle 1,000+ assets:** Implement an aggressive **World Streaming System**. The game must only load and render assets in the player's immediate vicinity (e.g., a 50m radius). As the player moves, unload old assets and stream in new ones.
- **Instancing:** Use `InstancedMesh` for every repeated object (trees, rocks, debris, buildings).
- **Extreme LODs:** Every single asset must have 3-4 LOD levels. If an object is far away, it should be a billboard or a 10-polygon mesh.

### YOUR EXECUTION PLAN
1. **Give me your architectural plan:** How will you implement the World Streaming system in Three.js? How will you manage memory to prevent crashes when loading thousands of assets?
2. **Give me your creative vision:** Describe the new massive, realistic environments you will build.
3. **Then, write the code:** Build the lighting, the post-processing, the asset loader, and the new map structures. 

Take your time, be incredibly creative, and push Three.js to its absolute breaking point. Surprise me with the scale and detail.

Change the look of all items, make them look entirely legendary, like precious treasures with colors and highly decorated like cod and sound effects from sources online for everything. I want alot of things going on in the game environments like sounds effects playing when players picks them, gamey background musics, and much moreeee asides the activities going on in a typical world environments. Like when i walk across or near a win turbine environments the turbines are constantly moving and they also hav their sounds too when i get closer to them and when i get farther away from them, and also like club playing loud music when close and music reduces when farther away and much more applied to every activity going on in the entire game environments.

Add more locations, terrains, found in a typical world not just similar buildings. Find sources online and get as much assets as you can get i mean alot of assets of the entire world design. Design the world to have locations that changes how the player sees (they should not be similar areas).

PROMPT 3

I need you to completely redesign the HUD (Heads-Up Display) and the post-match Victory/Defeat screens for the game. Before touching the actual game code, I want you to act as a UI/UX Architect and propose multiple design concepts.

Read the existing codebase first to understand the current HUD implementation, the variables being tracked (health, ammo, safe zone timer, player count, compass, etc.), the current audio manager, and the constraints of the game engine (React Native, Expo, Three.js).

### The Design Requirements
The new HUD must utilize the four core types of game UI design:
1. **Diegetic:** Elements that exist in the game world (e.g., a watch on the character's wrist, a backpack zipper acting as an inventory indicator, a glowing light on a gun for ammo).
2. **Non-Diegetic:** Traditional screen overlay elements (e.g., health bars, mini-maps, kill feeds, XP counters).
3. **Spatial:** Elements that exist in the 3D space but are meant for the player (e.g., floating waypoint markers, objective distances, off-screen damage indicators).
4. **Meta:** Effects that represent the player's status (e.g., blood splatters on the screen edge when health is low, screen distortion when in a sandstorm, heartbeat vignette when zombies are close).

### Audio, Animation & Post-Match Requirements
The HUD and UI are not just static visuals. The design must account for:
- **HUD Animations:** Smooth, tactical transitions. Health bars that pulse when low, kill feeds that slide in from the side, XP bars that fill up with a rolling number animation, and warning flashes for the shrinking safe zone.
- **HUD Sound Effects (SFX):** UI clicks, hover sounds, low-health warning beeps, safe-zone warning alarms, and a distinct "headshot" ping. These must be lightweight and pooled to prevent memory leaks.
- **Background Music:** How the HUD interacts with background music (e.g., music dynamically muffles or intensifies when health is low or when entering the final circle).
- **Victory/Defeat Screens:** You must design the end-of-match screens. These need cinematic animations (e.g., MVP character posing, XP bar rapidly filling up to level up the player's rank, loot rewards unlocking). They also require their own audio (Victory fanfare, Defeat sting) and must transition smoothly back to the main menu.

### The Art Direction
- **Inspiration:** Call of Duty (COD Mobile), Apex Legends, and other modern shooters/survival games.
- **Originality:** Do NOT make it an exact replica of COD. Take the clean, tactical, immersive feel of COD but create a distinct, unique identity for Emilgo Games.
- **Performance:** It must be lightweight and optimized for low-end phones (Tecno, Infinix). Avoid heavy screen blurring, massive particle effects, or complex animations that drop frames. Use CSS/React Native transforms for animations, not heavy physics engines.
- **Mode Specificity:** The HUD must adapt depending on whether the player is in "Dead Streets" (zombie survival) or "Free For All" (shrinking safe zone, melee).

### Your Task & Workflow

**Step 1: Concepting & Visual Mockups**
Do not write game code yet. I want to see your ideas first. 
Since you cannot generate JPG images, create **3 to 5 distinct HUD and Victory Screen concepts** using standalone HTML/CSS or React mockup files. Build a mini local "gallery" (an HTML file with tabs or side-by-side views) that I can open in my browser.
- Make these mockups visually rich and interactive.
- Include fake data (e.g., 75% health, 2:30 timer, 3 items in backpack) so I can see how it looks.
- *If possible in the mockup, add basic CSS animations to show how the kill feed or XP bar will move.*
- Include brief text descriptions explaining the philosophy of each concept, including where the audio cues (SFX/Music) would trigger.

**Step 2: Review & Approval**
Stop after generating the mockups. Tell me how to open them in my browser. Wait for me to review them. I will tell you which concept I like best, or if I want to mix and match elements from different concepts.

**Step 3: Implementation**
Once I approve a design, read the existing game codebase and bake the approved HUD, Victory/Defeat screens, audio hooks, and animations into the actual game. Ensure it connects correctly to the game's state (health, ammo, timers, XP, rank), handles the safe-zone logic, triggers the correct SFX, and runs at the required 30fps floor on low-end devices.

Ask me any clarifying questions before starting Step 1.

Before you start building anything, provide pictures of everything  including all assets and wait for my confirmation.

## The owner's answers after the concept pass (2 Nov 2026, evening)

> 1. i like HUD A - field kit with the edge reddens when hurt; the zone is an orange heat at the edges; in the (C) HUD - pulse, and health and touch bar in HUD C should move to HUD A but positioned at the center, also add the map without any HUD design(using the old design as the previous game) at the top right side in HUD A...welcome A. lobby A. for the welcome screen i like the background of the lobby B to be used instead on welcome A. and i want you to add "the next location full-bleed, this week's rotation, your squad's four slots, READY button style replaced with the play button style but still play as the text. and update the loadout section in lobby A to match the same HUD as HUD A i choose earlier.
>
> 2. yes to all mentioned and gun fired at anything shootable can be destroyed.
> 3. add guns
> 4. yes
> 5. bigger with more players.
> 6. yes
> 7. free assets first, setup the Megascans (Fab) or Sketchfab for when i have the account.
> 8. no do not make them giants just strong with visually strong armour which we will work on later.
> 9. yes, it stays hidden and untouched.
>
> "i want zoomibe to have health bar too when they are being shoot at. it shows the level of their life"
> compress some very heavy assets but leaving the details, to make the game lighter or much lighter to take up to 1million users at once.
>
> maybe we should reduce the total amount of assets to the most vital and important, every other assets remain lowpoly and comressed still leaving details.
>
> now start building and always autocompact where necessary, also do not forget to commit and push on repository, also build the entire upgrade baked into the game until completion without my approval, finish all phases, also keeping performance in mind, lastly do not forget to test with about 10k users. anyother upgrade will be after this build is completed, also watch for when my limit is reached and resetted keep on checking and continue building when my limit is resetted do not wait for me to tell you to continue building.... but first start with compacting and then build.
