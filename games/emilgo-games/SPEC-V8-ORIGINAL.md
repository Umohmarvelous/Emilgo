# SPEC-V8: the owner's brief, word for word (13 Nov 2026)

Everything below is the owner's own text, as sent in the session of 13 Nov 2026. The build order, the
answers and the Status of each row are in [SPEC-V8.md](SPEC-V8.md).

---

## Part 1: the owner's message (end screens, pre-match, the order)

> Another question, you provided some cool new ui design for a victory and defeat screen in v4 max mode spec
> which i said i love the first HUD design (A) and said you should implement it into the game but you did not
> (i will provide the image for the screens again), including the pre-match screen which you were supposed to
> add you did not add them, i want you to replace the currently exisiting victory and defeat screen with these
> i have just attached specifically HUD A (victory and defeat) but keep the existing victory background with
> the exisiting model character intact, combine all the features of these screen together (the xp progress
> bar, the medal, awards achieved, the collecting of gift, the streak and so on. do not lose any feature in
> this screen, this also goes for the prematch screen) tell me your reason first and then add these screens to
> the present version.
>
> then add these new upgrade prompt and any thing we shall finalize in this conversation to the latest version
> and handoff for the next session to start building all together and as usual orderly arrange them, in order
> of hierarchy where you strictly start building the features that does not require heavy autonomous build and
> build them first and then let me give the go-ahead to proceed and finish the build.

The pictures: the pre-match concept (`concepts/img/ui-prematch.jpg`) and the "Prompt 3 · Victory and defeat"
board (`concepts/index.html#ends`); the pick is **A · Field Kit · Victory** ("MISSION COMPLETE") and
**A · Field Kit · Defeat** ("KIA").

---

## Part 2: the new upgrade (final launch polish)

You are entering final launch polish mode. This is the last major upgrade before this game goes live as a standalone application. Read the existing codebase, structures, and systems carefully. Do not rewrite the game from scratch, but aggressively upgrade and refactor systems where necessary. 

You must go into maximum creative overdrive. Push the visual and mechanical realism to look like a multi-million dollar Unreal Engine 5 game, while strictly maintaining our mobile performance budget (smooth 30fps on low-end devices like Tecno/Infinix). Surprise me with your creativity, but ensure everything is wired perfectly and functions without errors.

Execute the following updates:

### 1. SYSTEM PURGE & BUG FIXES
- **Purge "Ball Haunt":** Completely delete everything related to the "Ball Haunt" / Red Light Green Light mode. Remove its code, assets, and logic.
- **Restart Bug:** Fix the restart logic in Free For All. If a player hits restart, they must restart the current FFA match, not the deleted game mode.
- **Timer Logic:** Remove the match timer and its entire logic from FFA. The game must ONLY end when: (A) All treasures are found and uploaded, OR (B) The safe zone closes completely and everyone dies.
- **De-Emilgo:** Remove every single mention of the word "Emilgo" from the game, as this is becoming a standalone app.
- **Billboard Fix:** Fix the unreachable billboard portal. The billboard booking system must not require a sign-in or login. Make it accessible instantly.

### 2. CHARACTER OVERHAUL & RIGGING (THE FIGURINE)
- **Proportions:** Slightly reduce the female model's breast size so it is not overly obvious. Reduce the hand size. Rebuild the shoulders so they look anatomically correct, blending naturally into the upper arm.
- **Facial & Hand Realism:** Upgrade the 3D models' hands, face, nose, and eyes. Make them look like highly detailed, premium realistic figurines (UE5 quality).
- **Skeletal Rigging:** Fully rig the arms, wrists, fingers, and shoulders so the character can perform all moves flawlessly.
- **COD Movement:** When moving left or right, the character must strafe (keep their torso and face pointing forward) exactly like Call of Duty Mobile. Do not make them turn their body to the side.

### 3. ANIMATION & LOCOMOTION
- **Running:** Make the run animation incredibly smooth and realistic, matching the weight and feel of COD Mobile.
- **Jumping:** Make the character jump significantly higher. Change the jump sound effect to something much more realistic and weighty.

### 4. VFX, EMOTES & TREASURES
- **The 4 Pickup FX (Be highly creative):**
  1.  *Physical Abilities:* Bring back the original physical ability orbit (before the recent updates). The character does the picking pose, then the epic power-absorption pose with the 360 camera.
  2.  *Electric Spark:* A tight, non-circular electrical spark VFX that moves along the contour of the character's body, highly centered on the chest. 
  3.  *Fire Skin:* A VFX where the character's skin cracks with glowing patches, and realistic fire erupts from the body (not an orbit, but a skin overlay).
  4.  *[Your Choice]:* Invent a 4th distinct, epic pickup FX.
- **Speed Ghosting:** Bring back the speed item VFX where a glowing reflection/ghost of the character trails behind them when they run.
- **Treasure Badges:** Redesign treasures to look like shiny, realistic officer badges (UE5 metal reflections). The container box must be completely invisible/transparent so the badge appears to float. When found, the badge must rotate slowly horizontally in the air.
- **Emotes:** Create 6–7 brand-new, highly creative emotes. Emotes must now work everywhere (in the lobby, waiting room, etc.), not just in matches.
- **Environment:** Add the flying birds from the old mode into the Free For All environment.

### 5. UI / HUD & AUDIO
- **Top-Center Notifications:** Change all dialog popups (e.g., "Empty Treasure") to appear as text-only alerts at the top-center of the screen (exactly like COD kill feeds). No boxes, no backgrounds.
- **Rank Badges:** Players cannot wear rank badges on their physical models in-game. Badges only appear on their profile card so others can see them there.
- **HUD Refinement:** Redesign the gameplay HUD to be more visually appealing, taking inspiration from COD Mobile. Place new control elements neatly on the sides of the screen without cluttering the view. Ensure it uses the existing HUD design language but upgraded.
- **Audio:** Add more realistic sound effects throughout the game.

### 6. PLATFORM & INPUT
- **Gamepad Support:** Wire the game to support PlayStation and Xbox controllers. Map the inputs (shooting, aiming, movement, jumping, interacting) seamlessly.

### YOUR EXECUTION
1. Review the current architecture.
2. Implement these upgrades sequentially. Do not break the core loop. 
3. Ensure the shaders, animations, and VFX use GPU instancing, LODs, and object pooling to guarantee buttery-smooth performance on mobile phones. 
4. Finalize the build and ensure everything works perfectly for launch.

---

## Part 3: Prompt 1, the Goku-style power-up pose and camera

This is an update to our power-up sequence. Ignore any previous instructions about the character falling to the ground or kneeling. I want a specific, iconic "power-up" pose inspired by the famous Goku transformation from Dragon Ball Z.

Read the existing character animation controller and camera logic before writing code. Keep mobile performance (React Native/Three.js, 30fps on Tecno/Infinix) in mind.

### THE POSE & ANIMATION
When a player collects a major buff, they stop immediately and transition into this epic stance:
- **The Stance:** The character plants their feet wide apart, bends their knees slightly for stability, puffs their chest out, and throws their head back slightly. 
- **The Arms:** Their arms are bent, fists clenched tightly at their sides (flexing).
- **The Animation:** The character is visibly straining, roaring upward as the power surges through them. The animation should feel weighty, intense, and grounded. 

### THE CAMERA (CINEMATIC)
- **The Freeze:** Time slows down slightly for 1.5 to 2 seconds.
- **The Angle:** The camera drops to a low angle (worm's-eye view) looking up at the character, making them look massive and powerful.
- **The Movement:** The camera does a slow, dramatic push-in (zoom) combined with a subtle upward tilt as the character powers up.
- **The Shake:** As the power peaks, add a subtle, high-frequency camera shake to simulate the raw energy vibrating the ground.

### YOUR TASK
1. Read the existing animation state machine.
2. Present a plan on how you will trigger this animation blend smoothly from standard movement (running/idle) and how the camera will smoothly detach, perform this cinematic angle, and return to gameplay.
3. Write the code for the animation state, the camera transition, and the low-angle cinematic shot.

---

## Part 4: Prompt 2, the fiery energy aura VFX

This is a separate prompt focusing entirely on the Visual Effects (VFX) for the power-up state, directly inspired by the blazing energy aura of a Super Saiyan. 

Read the existing particle systems, shaders, and Three.js setup before writing code. We must fake an Unreal Engine 5 look (like Niagara particle systems) but keep it strictly optimized for mobile devices (no expensive CPU fire simulations).

### THE VISUAL EFFECT: THE ENERGY AURA
When the character strikes the power-up pose, a massive, fiery energy aura erupts around their body.
- **The Eruption:** A pillar of glowing, fiery energy shoots straight up from the ground around the character's feet, enveloping their entire body.
- **The Aura (Looping):** While the buff is active, a continuous, flickering fire/energy aura wraps around the model. It should look alive, dancing around their silhouette.
- **Color Variations:** 
  - Use a golden-yellow aura for Strength buffs.
  - Use a fierce blue/cyan aura for Speed buffs.
- **The Base:** The ground beneath the character should have a glowing, cracked effect, or a swirling ring of energy.

### HOW TO BUILD IT (THREE.JS & PERFORMANCE)
- **Billboards & Shaders:** Do not spawn actual 3D fire particles. Use camera-facing billboards with custom fragment shaders (noise textures) that simulate roaring fire. 
- **Vertex Displacement:** Apply a subtle vertex displacement shader to the aura mesh so it warps and flickers organically.
- **Additive Blending:** Ensure the aura materials use Additive Blending so they emit light and blend beautifully with the environment.
- **Post-Processing:** Rely on your global HDR Bloom post-processing to make the center of the aura completely white-hot and blindingly bright.
- **Performance:** This effect must use a maximum of 2-3 draw calls. It must be GPU-driven.

### YOUR TASK
1. Review the current VFX setup.
2. Propose a plan for how you will build this shader-based fiery aura.
3. Write the code to generate the erupting energy pillar, the looping body aura, and the glowing ground effect, ensuring it looks intensely cinematic but performs flawlessly on low-end mobile phones.

---

## Part 5: the owner's extra asks (not part of the prompt)

> 1. i need any player to be able to play solo agains teams, they can enter the room that finds other players
>    to merge with them but if no players are found then they can still go alone) this is aside the invite match.
> 2. also i need you to push every control button in the game environments to the far corner of the player's
>    phone especially on potrait orientation on mobile device so the players can see and not get distracted by
>    the control icons
> 3. only a solo player can upload two treasure as they find them at a time, and when a player finds any
>    precious stone their location is exposed for another player to find them, kill them and steal all their
>    treasures, once a solo player who has uploaded any precious stone have been killed (while looking for other
>    remaining stones) thier already uploaded stones gets removed from the scan machine on their name and gets
>    transferred to whoever killed them.

> (Treasures) i said treasure as floating badges (or what do you think would make sense - badges or real look of
> precious stones?), the invisible box i was referring to was the existing circle icon not the actual box crest.
> so instead of those icons, use the floating real look treasures that is also looks realistic when found in a
> box.
>
> ok since you suggested precious stone that is fine with me, but i did not mean that these precious stones
> whould floats over every chest, i meant that the 5 icons that show on the game screen (the line-up icons of
> all treasure that gets highlited when any treasure if found is the one i meant - instead of these icons i need
> the realistic precious stones replaced with these icons, they get active and begin to animate when the
> treasure is found), the real precious stones will still rise out when found as the usual but this time with
> the real precious stones you will design, you should get realistic assets of these precious stones like
> goldbars, emerald). also i am thinking of making it 4 precious stones to be found instead of five(what do you
> think?) as i think 5 is alot. also, i like that everyone in a team can find these stones and for themselves
> and all win together, just as a solo player can haunt for all 4 stones and win alone, if a player from any
> team finds a stone it gets added to the team's profile and it is mentioned by the announcer's voice ai doing
> the voiceovers that says something like "your teammate have found one treasure."....
>
> for now let use hide all treasures in the chest box but in the future i like treasures to be hidden in certain
> locations where some treasures will not be hide in a chest box but scattered in different place and before a
> player can get a treasure they need to some sort of logic or hint that is given like a puzzle for players to
> think and solve before they can find a treasure (you make the suggestion how you think this will be possible
> and let us discuss about it).

> (The name) since the emilgo app is not yet publish i just thought it would not be wise to put that up on the
> game so it does not get the players confused, so replace it with something else. i like to change the name
> from silo zone to something else, something shorter and easy to remeber (you suggest for me)
>
> i would have taken stash but it is already owned by a company, i think lootline will do because haulr is hard
> to remeber, or do you have other suggestion?

> (Billboards) for now, let us just wire the billboard perfectly to allow signups but i need the billboard
> feature have a toogle on/off button that i can on/off anytime maybe if i notice that players are playing
> constantly after the game has been pushed then i can add that. we will be using either paystack or
> flutterwave for the checkout but the sign-in remain as long as it does not violates vatar agreements and rules.

> (Ball Haunt) Delete everywhere, including Lagos Life.

> (Services) so tell me how to get the redis address and profile service's address address (REDIS_URL,
> PROFILE_URL), or if that is something you can do then do it. you left the shop, payments and billboards main
> server on purpose without telling me?? why?.. i need you to wire the shop, payments and billboards server so
> that once there's enough players that needs the splitting then i can do it myself (again if you can wire it up
> for it to automatically split once there's enought players then do it instead of me having to do it myself).
>
> (Fly) just wire it but i do not have the money for a paid recources yet so if by creating this will make fly
> bill me for it then put it on hold.

> (Guns) And i need you to get assets of real guns or nearly real guns and use in this game, make sure they not
> heavy for perfomance.
>
> And i need a real gun mechnisms, i need you to be highly creative with this feature it is very crucial to me, i
> need you to suprise me, give me some highly advance shooting mechanism, you are free to get inspirations from
> other popular shooting game and wire the same system into this game , i need shooting and kill players to be
> highly epic and realistic. i have a prompt i will paste for the gun and shooting mechanism but i want you to
> add to it where necessary and go full max mode on this.

> (Voice) i have some voiceover from elevenlab, i cannot attach them here but i want you to use eleven lab voice
> for a male authoritative american voice for all voiceovers instead of the female chinese and ameriacn voice.
> so replace the female chinese and ameriacn voice with a male authoritative american voice.
>
> will gettin elevnlab api key cost me? if not, then i can get the key for you but wire everything first so once
> the key comes everything works automatically

---

## Part 6: the shooting Max Mode prompt

This is a "Max Mode" upgrade. I need you to completely overhaul the shooting mechanism in Emilgo Games to achieve hyper-realism, matching the gunplay feel of top-tier mobile shooters like Call of Duty Mobile and Free Fire. 

Read the existing weapon logic, camera controller, animation system, and particle/audio systems before writing anything. 

We are building a tactical shooter on mobile hardware using React Native and Three.js. It must look and feel incredibly realistic, but it MUST maintain our 30fps floor on low-end devices (Tecno/Infinix) and web browsers. 

Implement the following advanced shooting mechanics:

### 1. ADVANCED BALLISTICS & HIT DETECTION
- **Hitscan vs. Projectile:** Implement fast-moving projectiles for bullet travel time (so players have to lead their shots slightly at long distances), rather than instantaneous hitscan. 
- **Bullet Drop:** Add very subtle bullet drop over long distances to reward precision.
- **Damage Falloff:** Damage should decrease slightly the further the bullet travels.
- **Hitboxes:** Implement distinct hitboxes (Head, Torso, Limbs). Headshots should deal critical damage (e.g., 1.5x to 2x) with a distinct "headshot" audio ping. Limb shots should deal reduced damage.

### 2. RECOIL, SPREAD, & WEAPON HANDLING
- **Recoil Patterns:** Implement a spring-based recoil system. Weapons should kick up vertically and drift horizontally in a predictable pattern. The camera should shake slightly with each shot (Aim Punch).
- **Bullet Spread:** Moving while shooting, jumping, or hip-firing should drastically increase bullet spread (bloom). Aiming Down Sights (ADS) should tighten the spread to near-zero.
- **Weapon Sway & Breathing:** When ADS, the weapon should sway slightly to simulate breathing. Holding the breath (if you add a button for it) should steady the sway.
- **Sprint-to-Fire Delay:** Add a slight delay before a player can shoot after sprinting to prevent "run-and-gun" abuse.

### 3. REALISTIC ANIMATIONS & VFX (Fake UE5)
- **Muzzle Flash:** High-intensity, randomized HDR muzzle flashes using additive blending. 
- **Shell Ejection:** Eject 3D bullet casings that bounce on the ground with physics.
- **Impact Decals:** Bullets must leave decals on surfaces (bullet holes in walls, sparks on metal, dust on sand, blood on characters). Use an object pool for these decals to prevent memory leaks.
- **Reload Mechanics:** Distinguish between "Tactical Reload" (reloading with ammo still in the chamber — faster) and "Empty Reload" (requires chambering a round — slower).

### 4. CINEMATIC AUDIO & FEEDBACK
- **Spatial Audio:** Gunshots must sound different depending on distance and environment. Add "bullet whiz" sounds when a bullet flies past the player's head.
- **Hit Markers:** Add visual and audio hit markers (different sound for body shots vs. headshots vs. armor hits).
- **Controller/Haptic Feedback:** If on mobile, trigger the device's haptic engine briefly with every shot fired.

### 5. PERFORMANCE (NON-NEGOTIABLE)
To make this run on low-end phones:
- Do NOT use Unity/Unreal physics for bullets. Use mathematical raycasting or custom lightweight projectile math.
- **Object Pooling:** You must create an object pool for bullet holes, muzzle flashes, casings, and blood particles. Do not instantiate/destroy new objects every time a gun fires.
- Use simplified capsule colliders for character hitboxes instead of complex mesh colliders.

### YOUR TASK
1. Read the current weapon and camera code.
2. Present a detailed plan on how you will implement the ballistics, recoil math, and object pooling to ensure zero lag.
3. Once the plan is approved, write the code. Be highly creative with the VFX and audio feedback to make it feel like a AAA Unreal Engine shooter, even though it's running in a browser/React Native environment.
