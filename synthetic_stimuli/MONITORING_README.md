# Monitoring and Downloading Kaggle Output

This folder contains scripts for monitoring Kaggle kernel execution and downloading output images to your local `synthetic_stimuli` folder.

## Quick Start

### For the Duck Drawings Example

```bash
# Monitor locally and download to synthetic_stimuli/duck_drawings/
python monitor_and_download.py --mode local --kernel your-username/duck-generator --output_subdir duck_drawings

# Or monitor directly on Kaggle (in a notebook cell)
!python monitor_and_download.py --mode kaggle --output_subdir duck_drawings
```

## Scripts

### 1. `monitor_and_download.py` (Recommended)

Monitor a Kaggle kernel and automatically download PNG output files to a subfolder of `synthetic_stimuli/`.

**Two modes:**

#### Mode: `kaggle` (Run ON Kaggle)
Monitors `/kaggle/working/` directory for new PNG files and copies them to `synthetic_stimuli/output_subdir/`.

```python
!python monitor_and_download.py --mode kaggle --output_subdir duck_drawings
```

#### Mode: `local` (Run on your computer)
Uses Kaggle API to check kernel status, waits for completion, then downloads files.

```bash
python monitor_and_download.py --mode local --kernel your-username/kernel-name --output_subdir duck_drawings
```

**Arguments:**
- `--mode`: `kaggle` or `local` (required)
- `--kernel`: Kernel name (format: username/kernel-name) - required for local mode
- `--output_subdir`: Subdirectory name (default: `duck_drawings`)
- `--poll_interval`: Check interval in seconds (default: 30)
- `--max_files`: Stop after this many PNGs (default: 5)
- `--timeout_minutes`: Give up after this many minutes (default: 120)

### 2. `download_output.py` (Alternative)

Download output from a completed Kaggle kernel.

```bash
# Download from a completed kernel
python download_output.py --kernel your-username/kernel-name --output_dir ./output_images

# Wait for completion then download
python download_output.py --kernel your-username/kernel-name --wait --output_dir ./output_images
```

## Complete Workflow Example

### Step 1: Run generation on Kaggle

```python
# In a Kaggle notebook
!python generate_diffusion_images.py --prompt "black ink line art of a duck, white background, sketch style, clean outlines" -n 5 --seed 12345
```

### Step 2: Monitor and download

**Option A: On Kaggle (in the same notebook, after generation):**
```python
!python monitor_and_download.py --mode kaggle --output_subdir duck_drawings --max_files 5
```

**Option B: From your local computer:**
```bash
# Wait for kernel to complete and download
python monitor_and_download.py --mode local --kernel your-username/your-kernel --output_subdir duck_drawings --wait
```

### Step 3: Verify files

```bash
# Check downloaded images
ls -la synthetic_stimuli/duck_drawings/
```

## File Organization

Downloaded files are organized as:
```
synthetic_stimuli/
└── duck_drawings/
    ├── black_ink_line_art_of_a_duck_..._seed12345_(1of5).png
    ├── black_ink_line_art_of_a_duck_..._seed12346_(2of5).png
    └── ...
```

## Tips

1. **Kernel Names**: Find your kernel name in the Kaggle UI URL or use `kaggle kernels list`
2. **Multiple Runs**: Use different `--output_subdir` values for different generation runs
3. **Large Files**: The script only downloads PNG files by default
4. **Resume**: The monitor script will pick up new files as they appear

## Requirements

For local monitoring:
- Kaggle CLI configured (`kaggle.json` in `~/.kaggle/`)
- `uvx` installed (recommended: `pip install uvx`)

On Kaggle: All dependencies are pre-installed.
