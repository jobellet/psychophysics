#!/usr/bin/env python3
"""
Monitor a Kaggle kernel and download output images to synthetic_stimuli folder.

This script can work in two modes:
1. On Kaggle: Monitors /kaggle/working/ for new PNG files
2. Locally: Uses Kaggle API to check kernel status and download files

Usage on Kaggle (inside a notebook):
    !python monitor_and_download.py --mode kaggle --output_subdir duck_drawings

Usage locally:
    python monitor_and_download.py --mode local --kernel your-username/kernel-name --output_subdir duck_drawings
"""

import argparse
import os
import sys
import time
import shutil
import subprocess
import functools
from pathlib import Path

# Force immediate flushing for real-time logging
print = functools.partial(print, flush=True)


def parse_arguments():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Monitor and download Kaggle output images"
    )
    parser.add_argument(
        "--mode",
        type=str,
        choices=["kaggle", "local"],
        required=True,
        help="Mode: 'kaggle' (monitor /kaggle/working/) or 'local' (use Kaggle API)"
    )
    parser.add_argument(
        "--kernel",
        type=str,
        default="",
        help="Kaggle kernel name (required for local mode: username/kernel-name)"
    )
    parser.add_argument(
        "--output_subdir",
        type=str,
        default="duck_drawings",
        help="Subdirectory of synthetic_stimuli to save images (default: duck_drawings)"
    )
    parser.add_argument(
        "--poll_interval",
        type=int,
        default=30,
        help="Polling interval in seconds (default: 30)"
    )
    parser.add_argument(
        "--max_files",
        type=int,
        default=5,
        help="Stop when this many PNG files are found (default: 5)"
    )
    parser.add_argument(
        "--timeout_minutes",
        type=int,
        default=120,
        help="Timeout in minutes (default: 120)"
    )
    
    return parser.parse_args()


def run_kaggle_command(args):
    """Run a Kaggle CLI command."""
    kaggle_cmd = "kaggle"
    if not shutil.which("kaggle"):
        kaggle_cmd = "uvx --with kagglesdk<0.1.32 kaggle"
    
    cmd = [kaggle_cmd] + args
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result


def check_kernel_status(kernel_name):
    """Check if kernel is complete."""
    result = run_kaggle_command(["kernels", "status", kernel_name])
    if result.returncode != 0:
        return None
    return result.stdout.strip().upper()


def download_kernel_output(kernel_name, output_dir):
    """Download output from kernel."""
    result = run_kaggle_command(["kernels", "output", kernel_name, "-p", output_dir])
    return result.returncode == 0


def monitor_kaggle_workspace(output_subdir, poll_interval, max_files, timeout_minutes):
    """Monitor /kaggle/working/ for PNG files (run ON Kaggle)."""
    print(f"Monitoring /kaggle/working/ for PNG files...")
    print(f"Output will be copied to: synthetic_stimuli/{output_subdir}/")
    
    # Create output directory
    output_dir = Path("synthetic_stimuli") / output_subdir
    output_dir.mkdir(parents=True, exist_ok=True)
    
    start_time = time.time()
    timeout = timeout_minutes * 60
    found_files = set()
    
    while True:
        # Check for PNG files
        working_dir = Path("/kaggle/working/")
        if not working_dir.exists():
            print(f"  /kaggle/working/ not found. Are you on Kaggle?")
            time.sleep(poll_interval)
            continue
        
        png_files = list(working_dir.glob("*.png"))
        new_files = [f for f in png_files if f not in found_files]
        
        for f in new_files:
            # Copy to output directory
            dest = output_dir / f.name
            shutil.copy2(str(f), str(dest))
            print(f"  Copied: {f.name} -> synthetic_stimuli/{output_subdir}/")
            found_files.add(f)
        
        # Check if we have enough files
        if len(found_files) >= max_files:
            print(f"  Found {len(found_files)} PNG files. Done!")
            return list(found_files)
        
        # Check timeout
        elapsed = time.time() - start_time
        if elapsed > timeout:
            print(f"  Timeout after {timeout_minutes} minutes.")
            return list(found_files)
        
        # Wait
        time.sleep(poll_interval)


def monitor_local_kernel(kernel_name, output_subdir, poll_interval, timeout_minutes):
    """Monitor a remote Kaggle kernel and download files (run LOCALLY)."""
    print(f"Monitoring kernel {kernel_name}...")
    
    start_time = time.time()
    timeout = timeout_minutes * 60
    downloaded = False
    
    while True:
        # Check status
        status = check_kernel_status(kernel_name)
        
        if status is None:
            print(f"  Could not check status. Retrying...")
        elif "COMPLETE" in status:
            print(f"  Kernel completed!")
            # Download files
            output_dir = Path("synthetic_stimuli") / output_subdir
            output_dir.mkdir(parents=True, exist_ok=True)
            
            if download_kernel_output(kernel_name, str(output_dir)):
                print(f"  Files downloaded to: synthetic_stimuli/{output_subdir}/")
                downloaded = True
                break
            else:
                print(f"  Failed to download files.")
                break
        elif "ERROR" in status or "CANCEL" in status:
            print(f"  Kernel failed: {status}")
            break
        elif "RUNNING" in status or "QUEUED" in status:
            elapsed = time.time() - start_time
            print(f"  Status: {status} (elapsed: {elapsed/60:.1f} min)")
        else:
            print(f"  Unknown status: {status}")
        
        # Check timeout
        if time.time() - start_time > timeout:
            print(f"  Timeout after {timeout_minutes} minutes.")
            break
        
        time.sleep(poll_interval)
    
    return downloaded


def main():
    """Main function."""
    print("=" * 60)
    print("Kaggle Output Monitor and Downloader")
    print("=" * 60)
    
    args = parse_arguments()
    
    print(f"\nConfiguration:")
    print(f"  Mode: {args.mode}")
    print(f"  Output subdirectory: synthetic_stimuli/{args.output_subdir}")
    print(f"  Poll interval: {args.poll_interval} seconds")
    print(f"  Max files: {args.max_files}")
    print(f"  Timeout: {args.timeout_minutes} minutes")
    
    if args.mode == "local" and not args.kernel:
        print("\nERROR: --kernel is required for local mode")
        sys.exit(1)
    
    if args.mode == "kaggle":
        files = monitor_kaggle_workspace(
            args.output_subdir,
            args.poll_interval,
            args.max_files,
            args.timeout_minutes
        )
        print(f"\nTotal files copied: {len(files)}")
    else:  # local mode
        success = monitor_local_kernel(
            args.kernel,
            args.output_subdir,
            args.poll_interval,
            args.timeout_minutes
        )
        if success:
            print("\nDownload completed successfully!")
        else:
            print("\nDownload failed!")
            sys.exit(1)
    
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
