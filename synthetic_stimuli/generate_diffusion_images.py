#!/usr/bin/env python3
"""
Generate images using a diffusion model on Kaggle's GPU.

Usage:
    python generate_diffusion_images.py --prompt "a beautiful sunset" -n 5

This script runs on Kaggle and uses a diffusion model to generate multiple images
from a text prompt with different seeds for variability. All dependencies are
pre-installed on Kaggle.

Default model: runwayml/stable-diffusion-v1-5 (~2GB, fits in Kaggle's GPU memory)
"""

import argparse
import os
import sys
import random
import functools
from pathlib import Path

# Force immediate flushing for real-time logging on Kaggle
print = functools.partial(print, flush=True)


def check_dependencies():
    """Check if required packages are installed (pre-installed on Kaggle)."""
    print("Checking dependencies...")
    
    required_packages = {
        "torch": None,
        "diffusers": None,
        "transformers": None,
        "accelerate": None,
        "Pillow": "PIL",
    }
    
    missing = []
    for package, import_name in required_packages.items():
        try:
            if import_name:
                __import__(import_name)
            else:
                __import__(package)
        except ImportError:
            missing.append(package)
    
    if not missing:
        print("  All dependencies available.")
        return True
    
    print(f"  Missing packages: {missing}")
    print("  These should be pre-installed on Kaggle.")
    print("  If running locally, install with: pip install torch diffusers transformers accelerate Pillow")
    return False


def parse_arguments():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Generate images using a diffusion model on Kaggle"
    )
    parser.add_argument(
        "--prompt",
        type=str,
        required=True,
        help="Text prompt for image generation"
    )
    parser.add_argument(
        "-n", "--num_images",
        type=int,
        default=1,
        help="Number of images to generate (default: 1)"
    )
    parser.add_argument(
        "--model",
        type=str,
        default="runwayml/stable-diffusion-v1-5",
        help="HuggingFace model ID (default: runwayml/stable-diffusion-v1-5)"
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default="/kaggle/working/",
        help="Output directory for generated images (default: /kaggle/working/)"
    )
    parser.add_argument(
        "--width",
        type=int,
        default=512,
        help="Image width in pixels (default: 512)"
    )
    parser.add_argument(
        "--height",
        type=int,
        default=512,
        help="Image height in pixels (default: 512)"
    )
    parser.add_argument(
        "--num_inference_steps",
        type=int,
        default=30,
        help="Number of inference steps (default: 30, lower = faster but lower quality)"
    )
    parser.add_argument(
        "--guidance_scale",
        type=float,
        default=7.5,
        help="Guidance scale (default: 7.5)"
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Base seed (default: random). Each image will use seed + image_index."
    )
    
    return parser.parse_args()


def load_pipeline(model_id, torch_dtype=None):
    """Load the diffusion pipeline with memory optimization for Kaggle GPU."""
    print(f"Loading pipeline for model: {model_id}")
    
    try:
        from diffusers import DiffusionPipeline
        import torch
        
        import torch
        
        device = "cuda"
        
        # Memory optimization: enable attention slicing
        # This is crucial for running on Kaggle's limited memory
        enable_attention_slicing = True
        
        if torch_dtype is None:
            torch_dtype = torch.float16
        
        print(f"  Using CUDA with FP16 precision")
        
        # Load pipeline with memory optimizations
        print("  Loading model (this may take several minutes on first run)...")
        pipeline = DiffusionPipeline.from_pretrained(
            model_id,
            torch_dtype=torch_dtype,
            variant="fp16",
        )
        
        # Enable memory optimizations
        if enable_attention_slicing:
            pipeline.enable_attention_slicing()
            print("  Attention slicing enabled")
        
        pipeline.to(device)
        
        # Clean up memory
        import gc
        gc.collect()
        torch.cuda.empty_cache()
        
        print("  Pipeline loaded successfully.")
        return pipeline
        
    except Exception as e:
        print(f"  Error loading pipeline: {e}")
        print(f"  Model ID: {model_id}")
        import traceback
        traceback.print_exc()
        return None


def generate_image(pipeline, prompt, seed, width, height, num_inference_steps, guidance_scale):
    """Generate a single image with the given parameters."""
    try:
        import torch
        
        # Set seed for reproducibility
        if seed is not None:
            generator = torch.Generator(device="cuda")
            generator = generator.manual_seed(seed)
        else:
            generator = None
        
        # Generate image
        print("    Generating image...")
        image = pipeline(
            prompt=prompt,
            width=width,
            height=height,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            generator=generator,
        ).images[0]
        
        # Clean up memory after generation
        import gc
        gc.collect()
        torch.cuda.empty_cache()
        
        return image
    except Exception as e:
        print(f"  Error generating image: {e}")
        import traceback
        traceback.print_exc()
        return None


def save_image(image, filename):
    """Save image to file."""
    try:
        # Ensure directory exists
        os.makedirs(os.path.dirname(filename), exist_ok=True)
        image.save(filename)
        print(f"  Saved: {filename}")
        return True
    except Exception as e:
        print(f"  Error saving image: {e}")
        return False


def main():
    """Main function."""
    print("=" * 60)
    print("Kaggle Diffusion Image Generator")
    print("=" * 60)
    
    # Parse arguments
    args = parse_arguments()
    print(f"\nArguments:")
    print(f"  Prompt: {args.prompt}")
    print(f"  Number of images: {args.num_images}")
    print(f"  Model: {args.model}")
    print(f"  Output directory: {args.output_dir}")
    print(f"  Size: {args.width}x{args.height}")
    print(f"  Inference steps: {args.num_inference_steps}")
    print(f"  Guidance scale: {args.guidance_scale}")
    
    # Check dependencies
    if not check_dependencies():
        print("\nERROR: Failed to install/check dependencies.")
        sys.exit(1)
    
    # Import torch after installation
    import torch
    
    # Kaggle provides GPU, use it
    if not torch.cuda.is_available():
        print("\nERROR: No GPU detected. This script requires a GPU.")
        print("Make sure you're running on Kaggle with GPU enabled.")
        sys.exit(1)
    
    torch_dtype = torch.float16
    print(f"\nGPU Info:")
    print(f"  Device: {torch.cuda.get_device_name(0)}")
    print(f"  Memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.2f} GB")
    
    # Load pipeline
    pipeline = load_pipeline(args.model, torch_dtype)
    if pipeline is None:
        print("\nERROR: Failed to load pipeline.")
        sys.exit(1)
    
    # Generate images
    print(f"\nGenerating {args.num_images} images...")
    
    base_seed = args.seed if args.seed is not None else random.randint(0, 2**31 - 1)
    print(f"  Base seed: {base_seed}")
    
    success_count = 0
    for i in range(args.num_images):
        current_seed = base_seed + i
        print(f"\n  Image {i + 1}/{args.num_images} (seed={current_seed}):")
        
        # Generate image
        image = generate_image(
            pipeline,
            args.prompt,
            current_seed,
            args.width,
            args.height,
            args.num_inference_steps,
            args.guidance_scale
        )
        
        if image is not None:
            # Save image with safe filename
            import re
            safe_prompt = re.sub(r'[^\w\-_. ]', '_', args.prompt[:50])
            safe_prompt = safe_prompt.replace(' ', '_')
            filename = os.path.join(
                args.output_dir,
                f"{safe_prompt}_seed{current_seed}_({i+1}of{args.num_images}).png"
            )
            if save_image(image, filename):
                success_count += 1
        else:
            print(f"  Failed to generate image {i + 1}")
    
    # Summary
    print(f"\n" + "=" * 60)
    print(f"Generation complete: {success_count}/{args.num_images} images generated")
    print("=" * 60)
    
    if success_count > 0:
        print(f"\nOutput files in: {args.output_dir}")
        for file in os.listdir(args.output_dir):
            if file.endswith('.png'):
                print(f"  - {file}")
    else:
        print("\nNo images were generated. Check for errors above.")
    
    return 0 if success_count > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
