# One Node · Flux-2 Klein

A ComfyUI custom node that wraps the full Flux 2 Klein workflow into a single self-contained UI widget. No graph to build, no spaghetti wires to connect, just one powerful node with everything inside.

> *One Node to rule them all, One Node to find them,*
> *One Node to bring them all, and in ComfyUI bind them.*
>
> *— J.R.R. Tolkien, probably, if he used ComfyUI*

---

## What it does

The node has 5 modes, switchable with a single click:

**T2I** - standard text to image generation.

**I2I** - good for creating variations or gently nudging an image in a different direction.

**EDIT** - load one or two reference images and describe the change.

**PAINT** - three tools in one:
- Sketch: a full canvas with layers, brushes, shapes and more. Draw something and generate from it.
- Inpaint: paint a mask over the area you want to change, write what should be there instead.
- Outpaint: expand the image in any direction by dragging the edges.

**FACESWAP** - swap a face from a source image onto a target. Requires a Faceswap LoRA.

---

## Installation

Clone this repo into your ComfyUI `custom_nodes` folder:

```
cd ComfyUI/custom_nodes
git clone https://github.com/yanokusnir-ai/one-node-flux-2-klein.git
```

You need one additional custom node for inpaint and outpaint modes:
[ComfyUI-Inpaint-CropAndStitch](https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch) by lquesada. Just clone it into the same folder:

```
git clone https://github.com/lquesada/ComfyUI-Inpaint-CropAndStitch.git
```

Restart ComfyUI. The node appears as **One Node · Flux-2 Klein**.

---

## Models

This node works with any Flux 2 Klein model officially released by Black Forest Labs. GGUF versions are not currently supported.

You will find all officially released Flux 2 Klein models on the [Black Forest Labs HuggingFace page](https://huggingface.co/collections/black-forest-labs/flux2). Pick the variant that fits your VRAM and use case. You will need a diffusion model, a matching text encoder, and the VAE.

The Faceswap LoRA is required for the Faceswap mode. The BiRefNet model is optional, only needed for the Remove Background feature in PAINT mode.

**Text encoder for 9b models** (place in `models/text_encoders/`)
- [Download](https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-9b/tree/main/split_files/text_encoders)

**Text encoder for 4b model** (place in `models/text_encoders/`)
- [Download](https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/tree/main/split_files/text_encoders)

**VAE** (place in `models/vae/`)
- [Download](https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-9b/tree/main/split_files/vae)

**Faceswap LoRA** (place in `models/loras/`)
- [BFS Head Swap v1 (9b)](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/blob/main/bfs_head_v1_flux-klein_9b_step3500_rank128.safetensors)
- [BFS Head Swap v1 (4b)](https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap/blob/main/bfs_head_v1_flux-klein_4b.safetensors)

**Remove Background** (place in `models/background_removal/`)
- [Download](https://huggingface.co/Comfy-Org/BiRefNet/tree/main/background_removal)

---

## License note on Flux 2 Klein 9B

This node works with both the 4B and 9B variants of Flux 2 Klein. The 4B model is released under Apache 2.0 and can be used freely including commercially.

The 9B model is released under the **FLUX Non-Commercial License** by Black Forest Labs. This means you can use it for personal and research purposes, but commercial use is not permitted. If you use the 9B model, you are responsible for complying with that license. You can review it at https://huggingface.co/black-forest-labs/FLUX.2-klein-9B.

This node itself is fully open source with no restrictions.

---

## Support

If you find this useful and want to support further development:

[buymeacoffee.com/yanokusnir](https://buymeacoffee.com/yanokusnir)

Thanks. Now go make something cool. :)
