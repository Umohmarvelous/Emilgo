# EMILGO Games v6: the owner's brief, word for word (9 Nov 2026)

The ordered version, with what was built: [SPEC-V6.md](SPEC-V6.md).

---

this is the new update for version 6 below:
To answer your previous questions;
1. yes, you are right.
2. i actually prefer one voice for all phone just like cod-style, which do you think will be lighter?
3. no, leave it.
4. yes, the same size
5. Silo zone is better.
6. to the emilgo app
7. Brighter  is okay for now.
8. keep it.
9. i will but just make sure that players can customise their avatar but the default avatar will be player's avatar from lagoslife and their name too, and their money.

and i want player's money to increase depending on if they win the game or their level of the game just like cod. and keep the cp system intact and working, also with purchasing and ad system that plays everytime a user wants to purchase an item from store..



I do not want players to be able run into any thing like building and all, but they can jump on anything that is not that high.
I want you to add a new mode for just players to run to a finish line, make it look exact using the system as angry gran run, subway surfers, tempo run, sonic dash, jetpack, copy all these games style and bak into this mode.
Items are placed closer together and they are too many in some area, fix this, spread items everywhere and make items spin around or like move up and down constantly basically any kind of simple animation like the guns to let the player know also can you use other colours for the glow around the items depending on the type of items and I need some more items to automatically pick themselves when the close get too close to them and even walk through them.

And I said, remove all old items from previous build like collect hot pepper soup, collect kobo container and more of them etc.

When player pick up some items, it automatically changes the players and create an animation when they pick some items, a kind of animation like some light

I need network status showing when the user is offline and when network is restored just like cod-style.
me and meta ai was having a conversation about how you(Claude) can make this game app perform better (increase performance) so meta Ai suggested a few and I did also. I want you to study these conversation I will send to you now and see what to take from this or add to this even more strategy so that it will increase overall performance of this game. Here are the conversation below: 

These are just META AI's thought and suggestions, if you like or think any point will be highly helpful and works best then bake it to the game's code system if not, do not apply to the game's code system and backend, also be free to make your own suggestions. Make sure that you never change the game existing design, structure and graphics.

"""

ME: 
Suggest all the best ways i can wire my web game app i built using three.js and reactnative to highly increase performance, and not lag when up to 1million users starts playing on the game app. The goal of the game is to run on low end phones, setup very fast and run on standard phone with up to 1million + users and not lag and running on browser. Right now the game is using a realistic features, and it meant to look like unreal engine was used

META AI: 
This is the hard truth: You cannot run true Unreal Engine realism on a low-end phone in a browser with 1 million users at the same time if you do it the normal way.

But you CAN fake Unreal look on low-end phones, and handle 1M users — if you wire it like this:

1. THE GOLDEN RULE FOR YOUR GAME
*Don't render realism in real-time. Bake it.*
Unreal looks real because of baked lighting + high-quality textures, not because it renders everything live. You must do the same in http://Three.js.

*Do this:*
- Bake all shadows and lighting in Blender → export as lightmaps
- Turn OFF real-time shadows, turn OFF real-time reflections in-game
- Use ONE directional light only. No 10 lights.
- Use `MeshStandardMaterial` with low roughness maps to fake PBR
- Fake reflections with CubeMap / EnvMap, not real reflection probes
This alone will take you from 15 FPS to 55 FPS on low-end phones.

2. CLIENT PERFORMANCE - MAKE IT RUN ON LOW-END PHONES
This is where 90% of lag comes from.
*A. Geometry:*
- Target: Max 80k triangles visible on screen. Not 1 million.
- Use LOD: High model when close, low model when far. Use `THREE.LOD`
- Use InstancedMesh for trees, rocks, crowd, bullets — 1000 objects = 1 draw call, not 1000
- Merge static geometry with `BufferGeometryUtils.mergeGeometries()`

*B. Textures & Assets:*
- Never use 4K textures. Max 1024px for mobile, 512px for small props
- Compress: Use KTX2 + Basis Universal. It loads 6x faster
- Use Draco compression for 3D models — 90% smaller
- Total game size must be *under 40MB* for first load, rest stream later

*C. Rendering:*
- Cap pixelRatio: `Math.min(devicePixelRatio, 1.5)` — Don't use 3 on phones, it kills GPU
- Turn OFF antialias on low-end, turn ON `powerPreference: "high-performance"`
- Use `frameloop="demand"` in React Three Fiber if game is not always moving
- Use `dpr={[1, 1.5]}`
- Disable post-processing on low-end: No bloom, no blur. Use fake glow with sprite.

*D. React Native Wiring:*
- *DON'T use WebView for 1M users.* It will lag. Use *Expo + expo-gl + @react-three/fiber* natively.
- Keep UI in React Native Views, NOT in http://Three.js HTML. UI in 3D = lag.
- Use `zustand` + `transient` updates for game loop. Never use `useState` inside `useFrame()` — it re-renders 60x per second and kills phone.
- Put game logic in Web Worker / separate thread if possible.

3. FAST SETUP - LOAD IN UNDER 3 SECONDS
Low-end users will close app if it loads > 3s.
*Wire it like this:*
- Show menu / playable character IMMEDIATELY with low-res assets
- Stream high-res assets in background while they play — like PUBG Mobile does
- Use CDN for assets: Cloudflare R2 / Cloudinary / S3 + CloudFront
- Split game into chunks: `core.glb` (5MB) → `level1.glb` → `level2.glb`
- Use `Suspense` + lazy loading, don't load everything at start

4. SERVER FOR 1 MILLION USERS - THIS IS THE REAL PROBLEM
1M users doesn't lag your phone, it lags your server. You must build stateless.
*Don't do:* One http://Node.js server for all players.
*Do this architecture:*

*Frontend:* React Native / Web → *Cloudflare CDN* (static assets)
*Game Server:* Edge WebSocket servers (Cloudflare Workers / http://Fly.io / AWS)
*Backend API:* Stateless API (Node / Go) behind Load Balancer
*Database:* Redis for live player position + Postgres/Supabase for save data

*Rules for 1M:*
- Game is *Client-Authoritative for visuals, Server-Authoritative for score/money*. Never trust client for money.
- Send updates at *10 ticks per second, NOT 60*. Interpolate on client. This cuts server cost by 6x.
- Use *Rooms/Shards of max 50 players* per instance. 1M users = 20,000 rooms, not 1 giant world.
- Use *Binary protocol (MessagePack / Protobuf)* not JSON for multiplayer. JSON is 3x bigger.
- Use *WebSocket + UDP-like* (WebRTC DataChannel for fast games) — not HTTP polling.

*Best stack for you:*
- *Multiplayer:* Colyseus or Nakama (built for 1M users, auto-scaling)
- *Backend:* Supabase / Firebase for login + leaderboard (handles scale)
- *Hosting:* Vercel for web + http://Fly.io for game servers

5. HOW TO MAKE IT LOOK LIKE UNREAL ON LOW-END
Use these cheap tricks:
- *Fog + Bloom Fake:* Use fog to hide low-poly distance, add vignette
- *Screen Space:* Add film grain + color grading with ONE cheap shader, not 5 post effects
- *Characters:* Use 1 material for whole body, not 10 materials
- *Animation:* Bake animations, use 30 FPS animation, not 60
- *Water / Glass:* Use MeshPhysicalMaterial with 1 sample, not real refraction

FINAL WIRING PLAN FOR YOU:
1. Rebuild in *Expo + React Three Fiber + Zustand*
2. Bake lighting in Blender, export Draco + KTX2
3. Cap to 80k triangles, InstancedMesh everywhere
4. Use Colyseus for multiplayer, rooms of 50
5. Host assets on Cloudflare R2 CDN
If you do this, your game will load in 2-3s on a Tecno / Infinix low-end phone and still look realistic.

Send me:
1. What type of game is it? (Racing, Shooting, Open World, Football?)
2. Is it multiplayer real-time or single player with leaderboard?
I will give you the exact performance budget and folder structure for that type.


ME: 
Claude is helping me build the game app, but don't you think building it with microservices is also an option that helps performance?


META: 
Yes — you're 100% right. Microservices is an option, but for a *game*, you have to use it in the RIGHT place, or it will actually make you lag MORE.

Claude is helping you build it, so tell Claude this exact rule:

The Rule for Games

*Microservices = YES for everything OUTSIDE the match.*
*Microservices = NO for everything INSIDE the match.*

If you split your real-time game loop into microservices, every bullet, every movement will have to hop between 3-4 services. That adds 50ms - 100ms delay. On a low-end phone in Nigeria with already slow network, that = lag.

How to Wire It Correctly (Hybrid - Best for 1M Users)

Don't do pure microservices. Do *Modular Monolith + Microservices for background stuff.*

*1. KEEP TOGETHER (One fast service):*
This is your Game Room Server. It must be ONE process.
- Player movement
- Shooting / Collision
- Physics
- Room state

Why? It needs to run at 10-20 ticks per second with zero extra network hops. This is what Colyseus / Nakama does.

*2. SPLIT INTO MICROSERVICES (These help performance a lot):*
These are perfect for microservices because they are NOT real-time:
- *Auth Service* - Login, signup, JWT
- *Matchmaking Service* - Finds room for player
- *Leaderboard Service* - Score, ranking, Redis sorted set
- *Chat / Friends Service*
- *Payment / Shop Service* - Buy skins, coins, ads payment billing
- *Billboards*
- *Analytics Service* - Track who played, who quit
- *Multiplayer Service* - invite friends match

If Leaderboard crashes, your game should STILL keep playing. That's the power of microservices. If you put everything in one monolith, one crash kills all 1M users.

So Does Microservices Help Performance for 1M Users?

*YES, for scaling:*
- You can scale ONLY the service that is busy. If 500k people are checking leaderboard at once, you scale just Leaderboard, not the whole game.
- You can deploy a fix to Shop without restarting the game for everyone.

*NO, for in-game speed:*
- More services = more network calls = more latency
- More services = harder to debug for Claude / you

What To Tell Claude To Build

Tell Claude to build it like this:

> "Build a Modular Monolith for the Game Server, and Microservices for Auth, Matchmaking, Leaderboard, chat, payment, analytics, billboards and Shop. Use gRPC or Redis Pub/Sub between services, not HTTP REST for real-time."

*Best stack for this:*
- *Game Room:* Colyseus (Node) or Nakama (Go) - already built as this hybrid
- *Microservices:* http://Node.js / Go + Docker + Kubernetes (or http://Fly.io - easier)
- *Communication:* Redis for fast messages between services
- *API Gateway:* One entry point (Cloudflare / Kong) that routes to services

My Final Advice For You

For your goal (1M users, low-end phones):
*Don't start with 10 microservices.* You'll drown.

Start with:
1. *Game Server* (Monolith)
2. *Auth + Profile* (1 microservice)
3. *Leaderboard* (1 microservice)

That's 3 services. When you hit 100k users, split the rest. That's how PUBG, Free Fire, and Fortnite started.

Are you and Claude building the multiplayer part now, or is it still single-player? If it's multiplayer, I will give you the exact microservice map to paste to Claude.

""" we should wire up a Modular Monolith for the Game Server, and Microservices for all services mentioned to improve performance (you are free to approve or disapprove of any services mentioned by META AI or suggest services that you think would improve performance for thousands of players on this game all at once and wire/setup them up). 


More updates:
- Allow player be able to remove any control buttons or add any control button they want.
- Remove every control button by default except the jump, sprint, bend, backpack, aim, walk, speed walk, shoot(fire).
- Make the settings control be infant while the game environment
- Replace low-poly trees, cars and stones to a nearly realistic assets.
- None of the 11 places look like the original picture I saw in the v4 prd they do not even look realistic, fix this. Remember to fake it like unreal engine was used.
- Wire up flutter wave for ads payment billing for the web game only.
- I need some billboards to have two sides of ads showing and some other billboards having a more different look with lights for night like portraits build billboards for portrait ads.
- In the ads section where ads platform pay for ads, I want you to name every ads billboards with numbers like in lagoslife (billboard 1, billboard 2, billboard 3 and so on till the last billboard) and their location where they are to give the ad platform a sense of where there ads will be showing. any ad platform can choose to pay for a static billboard 
- 
- I need ads purchase to be in a place players can see it to add their ads and buy billboards.
- Show international ads on billboards that are not already taken like google ads, meta ads and the few ads platform that are already wired in this games (give me a list of all ads platform listed here and how I can integrate them in this game - if none already then setup up to 20 - 30 highest niche ads platforms that will start showing on our billboards until a local ads platform comes to buy a billboard. 
- Put price billing for ads platform willing to buy billboard. Price billing will be in two tiers for 1 week and 2 weeks.
- Every building and objects placed anywhere should be there for a good reason that fits the environments, do not just randomly place objects/assets anywhere that they do not have meaning for the environment.
- Draw other terrain location just a littler closer to the middle location.
- Add more details to the map design, redesign it with more features.
- When player's life span low and then finishes they dies, do not wait until 3minutes, it should be like cod-style.
- Work on the items, I need every items to work perfectly - be creative with this.
- Team leader's 3d model is very different from team member's 3d model but the same figurine and same build, I need like a difference that captain have than teammates like they have a strip on their biceps like in football how captains have a ribbon they tire on their biceps or like 
- Re-design the 3d model custom skin baked properly without having colours mixed weirdly onto the figurine parts of their body, any colour picked by the user will properly baked and applied on the 3d model. 
- I need more action figurine build up to 5 new figurines for sale in store (where players have to buy them with their cp), players can preview these other figurines but cannot use them in game.
- Recall what is the original cp system like? (What did we talk about the cp system), so I will know if you still remember or have forgotten.
- Among all emotes, I like shaku shaku. And zany remained everyone else must be removed, add more international dance steps with the exact dance step.
- Change all the control button, use cod-type icons.
- I want the model to make a sound to show that he is jumping whenever he jump and more for whenever action he is doing like jumping and more so it look real.
- Create and build the sprint moves like cod-style.
- Change all the gun sounds for all different guns, machine guns shoots faster and rapidly, while hand gun shot once once and so on for other guns.
- All terrain must have related assets placed to create the exact feel of that environment like if it is a mangrove forest, it will not just have the forest, there will be stones, rivers, grasses and more make every terrain real using all relevant assets downloaded. Compress assets that carry much size and heavy on low and medium graphic resolution.
- on mobile phone (portrait mode) look and move joystick move the same time, so when a player in on potrait mode and they come the joystick in the left direction the camera moves automatically to the left and vice versa placing the model in the center at all time (this applies to the free for all game mode on potrait mode on mobile phones only) just like Lagos life.
- Create alot of awards (with really cool realistic badges ), achievements scores, milestones and moreee that show on the player's model character and in the player's dashboards/profile. This dashboard is different from the player's lobby.

- I need claude to build a players dashboard/lobby where they see all there analytics, awards, achievements scores and so many many more analytics in the user's dashboards. This should also be added as a micro-service too. 
- Research and copy user's dashboards from popular games including cod-mobile style. User's dashboard must show everything the user's are, anyone can view certain part of their dashboard to know who exactly this user is. Enable text chatting everywhere like in the game, user's dashboard (where anybody can view another user's profile and can send text to them directly, they can even go beyond the game and agree to connect in real-life).

- I need jumping should take a little shorter time to happen.
- Remove all old cars, bus, keke in the game.


FOR YOU SUGGESTIONS
Yes to all suggestions made.


FOR YOUR QUESTIONS:
1. Health bars. Only shows when they are being shot at.
2. English with a Mandarin accent as long as it is the same agent on all devices.
3. I approve your recommendations
4. Same size, no giant anymore just make the armour more fiercer and slightly different look like a real robotic sci-fi helmet and more as they keep getting more physical items ability.
5. Leave only these items: Smoke Canister, Decoy Flag, Pulse Scanner, Squad Disguise, remove every other old items like Field Flask, Big Bag, Adrenaline Shot, Zone Shield, Fuel Jerrycan, Van Key. Make sure that all these items I have accepted must be highly working perfectly, and I want player to automatically do the picking pose when they get too close to any item, create the picking pose just like cod-style when and they pick items automatically without me having to click a button to pick up item.
6. I think silo zone is better. I need a name that players(users) can remember anytime but still sounds combat-like.
7. The emilgo app but the game first when the button says "play now".
8. Never mind, I only used that name because I thought what I was referring to was the actual name but it's not.
9. Yes, keep them but most especially I need you to create a swim pose for when the player enters a river, and make rivers to fake unreal engine look with splashes and sound effect, while keeping performance in mind.



Updates for vfx orbit around player
I need to add a highly cinematic, "Unreal Engine style" visual effect for when a player collects an item (like a speed boost, armor, or weapon) in Emilgo Games. 

### THE VISUAL CONCEPT
When a 3D model touches a collectible item, the item disappears and immediately triggers a "transformation aura." 
1. **The Orbit:** 10–20 glowing, light-like streaks instantly spawn and orbit around the player's character mesh. They should spiral and weave around the body.
2. **The Glow:** The streaks emit an intense HDR glow (using Additive Blending). 
3. **The Absorption/Fade:** After exactly 1.5 seconds, the streaks suddenly snap inward into the character's chest, or rapidly fade out into a burst of glowing particles.
4. **Reference:** Think of the "Power-Up" effects in Destiny 2, the ultimate charge in Overwatch, or the Unreal Engine 5 Niagara particle system.

### PERFORMANCE & "FAKE UNREAL ENGINE" CONSTRAINTS
This must run at 30fps on a Tecno/Infinix phone in React Native / Three.js. Therefore:
- Do NOT use CPU-heavy particle physics for the light streaks. Use a single `InstancedMesh` or a custom vertex shader to control the orbit math entirely on the GPU.
- Use **Additive Blending** on the streak materials so they emit light without needing actual light sources.
- Do NOT use real-time point lights (they are too expensive). Fake the glow using a high-quality Bloom post-processing effect.
- Use a pre-baked sprite sheet or a shader-based trail for the light streaks to keep memory usage low.

### YOUR TASK
1. Read the existing item pickup and character controller code.
2. Propose a plan for how you will build this effect in Three.js. Explain how you will handle the orbit math (shader vs. CPU) and the performance optimization.
3. Write the code to generate this light streak orbit effect. Make it highly creative, visually spectacular, and perfectly optimized for mobile devices.


This is an update and expansion to the previous "Power-Up / Item Pickup Aura" prompt. I need to build a highly cinematic, "Unreal Engine 5 style" transformation sequence for when a player collects a major item (like a Strength Booster or Speed Booster) in Emilgo Games. 

Read the existing character controller, camera system, item pickup logic, and VFX/Shader setup before implementing. Keep the mobile performance constraints (30fps on Tecno/Infinix) in mind at all times.

Here is the exact sequence and visual effect I want you to build:

### 1. THE EPIC TRANSFORMATION POSE & 360 CAMERA
- **The Freeze:** When the item is collected, the game instantly enters a 0.5-second slow-motion state.
- **The Pose:** The 3D character strikes an epic, cinematic pose. Think of a superhero landing, a character bracing against a powerful wind, or the iconic "Super Saiyan" power-up stance (legs slightly apart, fists clenched, chest pushed forward, head looking up).
- **The Camera:** The camera immediately detaches from the standard gameplay view. It swoops in and performs a smooth, dramatic 360-degree orbit around the character while they are in this pose. (This should feel like a cutscene killcam but for a power-up).
- **The Aura:** As the camera orbits, the light streaks (from the previous prompt) spiral rapidly around the model, creating a vortex of glowing energy.

### 2. POST-TRANSFORMATION VFX (UNREAL ENGINE STYLE)
After the 360-camera spin finishes (about 1.5 seconds total), the camera snaps back to gameplay, and the character is permanently transformed for the duration of the buff.
- **Glowing Eyes:** Give the character's eyes (or helmet visor) a bright, glowing Emissive shader. Make it look like flames or pure energy are leaking from their eyes (reference: Call of Duty Zombies perk-a-cola, or Doom Slayer).
- **Body Aura:** Surround the character with a subtle, looping VFX aura. 
  - *If it's a Strength buff:* A fiery, red/orange aura with small lightning arcs or heat distortion (faked using vertex displacement).
  - *If it's a Speed buff:* A crackling blue/white electric aura with trailing after-images (ghosting) when they run.
- **Shockwave:** The moment the pose finishes, trigger a ground shockwave (an expanding glowing ring) that pushes outward, visually showing the power surge.

### 3. STAT BOOSTS & MECHANICS
- **Strength Item:** The player's melee damage and weapon damage are increased. Their movement speed remains the same, but their footsteps are heavier.
- **Speed Item:** The player's movement and sprint speed are significantly increased. 
- When the buff expires, all VFX fade out, the eyes return to normal, and the stats reset.

### 4. PERFORMANCE & FAKING UE5
- **Slow-Mo:** Do not actually change the physics time-scale (which causes desync in multiplayer). Instead, fake the slow-mo by slowing down the animation mixer for the character.
- **Camera:** Use a simple Bézier curve for the 360-camera orbit so it doesn't clip into walls.
- **Aura & Flames:** Use camera-facing billboards, sprite sheets, and additive blending for the aura and eye flames. Do NOT use expensive volumetric fire or real-time dynamic lights for the aura. Use a global Post-Processing Bloom to make the aura and eyes look intensely bright and realistic.

### YOUR TASK
1. Review the current codebase for the item pickup and camera systems.
2. Provide a step-by-step plan on how you will implement the slow-mo, the camera orbit, the VFX, and the stat changes.
3. Write the code to make this cinematic sequence happen. Be highly creative with the visual effects, particle math (using GPU instancing), and shader setups. Make it feel like a million-dollar Unreal Engine cutscene running smoothly on a mobile phone.


Orderly arrange this prompt, in order of hierarchy where you strictly start building the features that does not require heavy autonomous build and build them first and then let me give the go-ahead to proceed and finish the build.

(9 Nov 2026, between two turns: "continue building", twice.)
