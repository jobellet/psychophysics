#!/usr/bin/env python3
"""
Download output images from a Kaggle kernel to a local directory.

Usage:
    python download_output.py --kernel your-username/kernel-name --output_dir ./duck_drawings

This script checks if a Kaggle kernel has completed and downloads its output
images to a specified local directory.
"""

import argparse
import os
import sys
import subprocess
import shutil
import time
import functools

# Force immediate flushing for real-time logging
print = functools.partial(print, flush=True)


def run_kaggle_command(args):
    """Run a Kaggle CLI command and return the result."""
    # Try to find kaggle command
    kaggle_cmd = "kaggle"
    if not shutil.which("kaggle"):
        # Try with uvx
        kaggle_cmd = "uvx --with kagglesdk<0.1.32 kaggle"
    
    cmd = [kaggle_cmd] + args
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result


def check_kernel_status(kernel_name):
    """Check the status of a Kaggle kernel."""
    result = run_kaggle_command(["kernels", "status", kernel_name])
    
    if result.returncode != 0:
        print(f"Error checking status: {result.stderr}")
        return None
    
    status = result.stdout.strip().upper()
    return status


def wait_for_completion(kernel_name, poll_interval=60, timeout_minutes=120):
    """Wait for a Kaggle kernel to complete."""
    print(f"Waiting for kernel {kernel_name} to complete...")
    print("Press Ctrl+C to stop waiting.")
    
    start_time = time.time()
    timeout_seconds = timeout_minutes * 60
    
    while True:
        status = check_kernel_status(kernel_name)
        
        if status is None:
            print("  Could not get status, retrying...")
        elif "COMPLETE" in status:
            print(f"  Kernel completed successfully!")
            return True
        elif "ERROR" in status or "CANCEL" in status:
            print(f"  Kernel failed or was cancelled: {status}")
            return False
        elif "RUNNING" in status or "QUEUED" in status:
            elapsed = time.time() - start_time
            print(f"  Status: {status} (elapsed: {elapsed/60:.1f} min)")
        else:
            print(f"  Unknown status: {status}")
        
        # Check timeout
        if time.time() - start_time > timeout_seconds:
            print(f"  Timeout reached after {timeout_minutes} minutes.")
            return False
        
        time.sleep(poll_interval)


def download_kernel_output(kernel_name, output_dir):
    """Download output files from a Kaggle kernel."""
    print(f"Downloading output from {kernel_name}...")
    
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)
    
    # Download files
    result = run_kaggle_command(["kernels", "output", kernel_name, "-p", output_dir])
    
    if result.returncode != 0:
        print(f"Error downloading: {result.stderr}")
        return False
    
    print(f"  Files downloaded to: {output_dir}")
    return True


def filter_and_organize_images(input_dir, output_dir, prefix=""):
    """Filter PNG images and organize them in the output directory."""
    print(f"Organizing images...")
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Find all PNG files
    png_files = []
    for root, dirs, files in os.walk(input_dir):
        for file in files:
            if file.lower().endswith('.png'):
                png_files.append(os.path.join(root, file))
    
    if not png_files:
        print("  No PNG files found.")
        return 0
    
    # Copy PNG files to output directory
    for src_file in png_files:
        filename = os.path.basename(src_file)
        if prefix:
            # Add prefix to filename
            name, ext = os.path.splitext(filename)
            new_filename = f"{prefix}_{name}{ext}"
        else:
            new_filename = filename
        
        dst_file = os.path.join(output_dir, new_filename)
        shutil.copy2(src_file, dst_file)
        print(f"  Copied: {filename} -> {dst_file}")
    
    return len(png_files)


def parse_arguments():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Download output from Kaggle kernel and organize images"
    )
    parser.add_argument(
        "--kernel",
        type=str,
        required=True,
        help="Kaggle kernel name (format: username/kernel-name)"
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default="./output_images",
        help="Local directory to save images (default: ./output_images)"
    )
    parser.add_argument(
        "--wait",
        action="store_true",
        help="Wait for kernel to complete before downloading"
    )
    parser.add_argument(
        "--poll_interval",
        type=int,
        default=60,
        help="Polling interval in seconds (default: 60)"
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=120,
        help="Timeout in minutes (default: 120)"
    )
    parser.add_argument(
        "--prefix",
        type=str,
        default="",
        help="Prefix to add to downloaded filenames"
    )
    
    return parser.parse_args()


def main():
    """Main function."""
    print("=" * 60)
    print("Kaggle Output Downloader")
    print("=" * 60)
    
    args = parse_arguments()
    
    print(f"\nArguments:")
    print(f"  Kernel: {args.kernel}")
    print(f"  Output directory: {args.output_dir}")
    print(f"  Wait for completion: {args.wait}")
    print(f"  Prefix: {args.prefix if args.prefix else '(none)'}")
    
    # Create a temporary download directory
    temp_dir = os.path.join(args.output_dir, "_temp_download")
    
    # If waiting, wait for completion first
    if args.wait:
        if not wait_for_completion(args.kernel, args.poll_interval, args.timeout):
            print("\nERROR: Kernel did not complete successfully.")
            sys.exit(1)
    
    # Download output
    if not download_kernel_output(args.kernel, temp_dir):
        print("\nERROR: Failed to download output.")
        sys.exit(1)
    
    # Filter and organize images
    final_dir = os.path.join(args.output_dir, os.path.basename(args.kernel))
    count = filter_and_organize_images(temp_dir, final_dir, args.prefix)
    
    # Clean up temp directory
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    
    print(f"\n" + "=" * 60)
    print(f"Downloaded {count} images to: {final_dir}")
    print("=" * 60)
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
