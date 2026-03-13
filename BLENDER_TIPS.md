# Blender Tips

## Pin Left Hand To Katana

- Rig/context used: `Character_All` armature, `Katana` mesh parented to `KatanaControl`
- Goal: keep the left hand attached to the katana while preserving the frame-0 grip pose

Steps used:
- Create an empty named `LeftHandKatanaGripTarget`
- Put it at the left-hand contact point from frame `0`
- Parent that empty to the `Katana` object so it moves with the weapon
- Add an `IK` constraint to `left_wrist`
- Set the IK target to `LeftHandKatanaGripTarget`
- Increase `chain_count` to `3`
- Disable stretch on the IK constraint
- Add a `Copy Rotation` constraint to `left_wrist`
- Point that rotation constraint at `LeftHandKatanaGripTarget`
- Use world-space target/owner rotation so the wrist keeps the katana-relative orientation

Important detail:
- Position-only IK caused the wrist to twist unnaturally
- The fix was to rebuild the target from the pre-pin frame-0 pose and preserve the original wrist orientation relative to the katana, not just the hand position

Known limitation:
- This worked well enough without a pole target, but if the elbow starts flipping, the next fix is to add a left-arm pole target
