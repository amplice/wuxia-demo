import bpy
runtime_glb = r"C:\Users\cobra\wuxia-warrior\spearman.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=runtime_glb)
print('loaded', runtime_glb)
