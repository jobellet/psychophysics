# Diffusion Image Generator for Kaggle GPU

Generate images using Stable Diffusion on Kaggle's free GPU.

## Quick Start

Upload `generate_diffusion_images.py` to a Kaggle notebook and run:

```python
!python generate_diffusion_images.py --prompt "a beautiful sunset" -n 5
```

## Usage

```bash
python generate_diffusion_images.py --prompt "your prompt" -n 5
```

### Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--prompt` | Text prompt for image generation | *(required)* |
| `-n, --num_images` | Number of images to generate | 1 |
| `--model` | HuggingFace model ID | `runwayml/stable-diffusion-v1-5` |
| `--output_dir` | Output directory | `/kaggle/working/` |
| `--width` | Image width | 512 |
| `--height` | Image height | 512 |
| `--num_inference_steps` | Inference steps (lower = faster) | 30 |
| `--guidance_scale` | Guidance scale | 7.5 |
| `--seed` | Base seed (each image uses seed + index) | random |

### Examples

```bash
# Generate 5 images
!python generate_diffusion_images.py --prompt "abstract art" -n 5

# Generate with custom size
!python generate_diffusion_images.py --prompt "landscape" -n 3 --width 256 --height 256

# Use a specific seed for reproducibility
!python generate_diffusion_images.py --prompt "test" -n 2 --seed 42
```

## Models

Use lightweight models that fit in Kaggle's ~13-16 GB GPU memory:

- `runwayml/stable-diffusion-v1-5` (default, ~2GB)
- `stabilityai/stable-diffusion-2-1-base` (~2GB)
- `CompVis/stable-diffusion-v1-4` (~2GB)

Avoid SDXL models as they may exceed Kaggle's memory limits.

## Memory Optimization

The script automatically applies:
- **Attention Slicing**: Reduces memory usage during inference
- **FP16 Precision**: Uses 16-bit floats on GPU
- **Memory Cleanup**: Clears cache between image generations

For lower memory usage, reduce `--num_inference_steps` (20-25 works well on Kaggle).

## Output

Images are saved to `/kaggle/working/` with names like:
```
your_prompt_seed12345_(1of5).png
your_prompt_seed12346_(2of5).png
...
```

## Requirements

All dependencies are **pre-installed on Kaggle**:
- `torch`
- `diffusers`
- `transformers`
- `accelerate`
- `Pillow`

## Kaggle Setup

1. Create a Kaggle account and verify your phone number (required for GPU access)
2. Create a new Notebook (https://www.kaggle.com/kernels)
3. Upload `generate_diffusion_images.py`
4. In a code cell, run: `!python generate_diffusion_images.py --prompt "your prompt" -n 5`
5. Download results from the "Data" tab after completion

## Using Kaggle CLI

```bash
# Initialize kernel directory
kaggle kernels init -p ./kaggle_run

# Copy script
cp generate_diffusion_images.py kaggle_run/

# Create kernel-metadata.json
cat > kaggle_run/kernel-metadata.json << EOF
{
  "id": "your-username/diffusion-generator",
  "title": "Diffusion Image Generator",
  "code_file": "generate_diffusion_images.py",
  "language": "python",
  "kernel_type": "script",
  "enable_gpu": true,
  "enable_internet": true
}
EOF

# Push and run
kaggle kernels push -p ./kaggle_run

# Download output
kaggle kernels output your-username/diffusion-generator -p ./output/
```

## Notes

- **GPU Time**: Free tier provides ~30 hours/week
- **Max Runtime**: 12 hours per kernel
- **Seeds**: Each image gets a unique seed (base_seed + image_index) for variability
