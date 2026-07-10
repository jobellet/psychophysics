"""
Bistable Colored Images Generator

This script creates bistable perception images by:
1. Taking two input images
2. Computing their contours
3. Coloring each contour with complementary hues
4. Merging the colored contours
5. Iteratively transforming lines into geometric colored blobs

The result creates ambiguous images where attending to one color hue
makes the other image invisible, producing bistable perception.

Usage:
    python bistable_colored_images.py --image1 path/to/image1.jpg --image2 path/to/image2.jpg
    python bistable_colored_images.py --image1 path/to/image1.jpg --image2 path/to/image2.jpg --output output.png --iterations 5 --blob_size 15
"""

import argparse
import random
import numpy as np
import cv2
from typing import Tuple, Optional
from pathlib import Path
import colorsys


def load_image(image_path: str) -> np.ndarray:
    """Load an image from file path and convert to grayscale."""
    image = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError(f"Could not load image from {image_path}")
    return image


def compute_contours(image: np.ndarray, threshold: float = 0.5, 
                     sigma: float = 1.0) -> np.ndarray:
    """
    Compute contours from an image using Canny edge detection.
    
    Args:
        image: Input grayscale image
        threshold: Threshold for edge detection (0-1)
        sigma: Standard deviation for Gaussian blur
        
    Returns:
        Binary contour image
    """
    # Normalize image to 0-1 range
    if image.dtype != np.float32:
        image = image.astype(np.float32) / 255.0
    
    # Apply Gaussian blur
    blurred = cv2.GaussianBlur(image, (0, 0), sigma)
    
    # Compute edges using Canny
    # Convert threshold to appropriate values for Canny
    median_intensity = np.median(blurred)
    lower_thresh = int(max(0, median_intensity * (1 - threshold)) * 255)
    upper_thresh = int(min(1, median_intensity * (1 + threshold)) * 255)
    
    edges = cv2.Canny((blurred * 255).astype(np.uint8), 
                     lower_thresh, upper_thresh, apertureSize=3)
    
    # Convert back to float 0-1
    return edges.astype(np.float32) / 255.0


def get_complementary_hues() -> Tuple[Tuple[float, float, float], 
                                        Tuple[float, float, float]]:
    """
    Generate two random complementary hues in HSV color space.
    
    Complementary colors are opposite on the color wheel (180 degrees apart).
    
    Returns:
        Tuple of two complementary colors in HSV format (h, s, v) with h in [0,1]
    """
    # Random hue for first color (0-1)
    hue1 = random.random()
    
    # Complementary hue (opposite on color wheel)
    hue2 = (hue1 + 0.5) % 1.0
    
    # Use high saturation and value for vibrant colors
    saturation = 0.9 + random.random() * 0.1  # 0.9-1.0
    value = 0.9 + random.random() * 0.1      # 0.9-1.0
    
    color1 = (hue1, saturation, value)
    color2 = (hue2, saturation, value)
    
    return color1, color2


def hsv_to_rgb(hsv_color: Tuple[float, float, float]) -> Tuple[float, float, float]:
    """Convert HSV color to RGB (all values in 0-1 range)."""
    h, s, v = hsv_color
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return (r, g, b)


def color_contours(contours: np.ndarray, color: Tuple[float, float, float],
                  background: Tuple[float, float, float] = (0, 0, 0)) -> np.ndarray:
    """
    Color the contours with the specified color.
    
    Args:
        contours: Binary contour image (0-1)
        color: RGB color to apply to contours (0-1 range)
        background: RGB background color (0-1 range)
        
    Returns:
        RGB image with colored contours
    """
    height, width = contours.shape
    rgb_image = np.zeros((height, width, 3), dtype=np.float32)
    
    # Set background
    rgb_image[:, :, 0] = background[0]
    rgb_image[:, :, 1] = background[1]
    rgb_image[:, :, 2] = background[2]
    
    # Apply color to contours
    for c in range(3):
        rgb_image[:, :, c] = np.where(contours > 0, color[c], rgb_image[:, :, c])
    
    return rgb_image


def merge_colored_contours(contours1: np.ndarray, color1: Tuple[float, float, float],
                          contours2: np.ndarray, color2: Tuple[float, float, float],
                          background: Tuple[float, float, float] = (0, 0, 0)) -> np.ndarray:
    """
    Merge two colored contour images into one.
    
    Args:
        contours1: First binary contour image
        color1: Color for first contours
        contours2: Second binary contour image
        color2: Color for second contours
        background: Background color
        
    Returns:
        Merged RGB image
    """
    height, width = contours1.shape
    merged = np.zeros((height, width, 3), dtype=np.float32)
    
    # Set background
    merged[:, :, 0] = background[0]
    merged[:, :, 1] = background[1]
    merged[:, :, 2] = background[2]
    
    # Apply first color to its contours
    for c in range(3):
        merged[:, :, c] = np.where(contours1 > 0, color1[c], merged[:, :, c])
    
    # Apply second color to its contours (overwrites where both exist)
    for c in range(3):
        merged[:, :, c] = np.where(contours2 > 0, color2[c], merged[:, :, c])
    
    return merged


def dilate_contours(contours: np.ndarray, kernel_size: int = 3) -> np.ndarray:
    """Dilate contours to make lines thicker."""
    kernel = np.ones((kernel_size, kernel_size), np.uint8)
    dilated = cv2.dilate((contours * 255).astype(np.uint8), kernel, iterations=1)
    return dilated.astype(np.float32) / 255.0


def create_blob_mask(shape: Tuple[int, int], center: Tuple[int, int],
                    size: int, irregularity: float = 0.0) -> np.ndarray:
    """
    Create a circular blob mask with optional irregularity.
    
    Args:
        shape: (height, width) of the mask
        center: (y, x) center of the blob
        size: Radius of the blob
        irregularity: Amount of distortion (0 = perfect circle, higher = more irregular)
        
    Returns:
        Binary mask of the blob
    """
    height, width = shape
    y, x = center
    
    # Create grid
    yy, xx = np.meshgrid(np.arange(height), np.arange(width))
    
    # Distance from center
    distance = np.sqrt((xx - x)**2 + (yy - y)**2)
    
    # Create base circle
    mask = distance <= size
    
    # Add irregularity using Perlin-like noise
    if irregularity > 0:
        # Simple noise pattern
        noise = np.zeros_like(distance)
        for i in range(height):
            for j in range(width):
                # Simple pseudo-random noise based on coordinates
                noise[i, j] = (i * 0.1 + j * 0.1 + i * j * 0.001) % 1.0
        
        # Distort the boundary
        distortion = irregularity * size * (noise - 0.5)
        mask = distance <= (size + distortion)
    
    return mask.astype(np.float32)


def contours_to_blobs(contours: np.ndarray, target_blob_size: int, 
                     irregularity: float = 0.3) -> np.ndarray:
    """
    Transform contour lines into geometric colored blobs.
    
    This function:
    1. Finds connected components in the contours
    2. For each component, creates a blob centered at its centroid
    3. The blob size is proportional to the component size
    
    Args:
        contours: Binary contour image
        target_blob_size: Target size for blobs (in pixels)
        irregularity: Amount of shape irregularity (0-1)
        
    Returns:
        Binary image with blobs instead of lines
    """
    # Find connected components
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
        (contours * 255).astype(np.uint8), connectivity=8)
    
    # Skip background (label 0)
    height, width = contours.shape
    result = np.zeros_like(contours)
    
    for i in range(1, num_labels):
        # Get component properties
        area = stats[i, cv2.CC_STAT_AREA]
        centroid_x = int(centroids[i, 0])
        centroid_y = int(centroids[i, 1])
        
        # Scale blob size based on component area
        # Larger components get larger blobs
        component_blob_size = int(target_blob_size * (1 + np.log1p(area) / 100))
        component_blob_size = max(1, component_blob_size)
        
        # Create blob at centroid
        blob_mask = create_blob_mask((height, width), 
                                     (centroid_y, centroid_x),
                                     component_blob_size, irregularity)
        
        # Add blob to result
        result = np.maximum(result, blob_mask)
    
    return result


def iterative_blob_transformation(merged_contours: np.ndarray, 
                                   color1: Tuple[float, float, float],
                                   color2: Tuple[float, float, float],
                                   num_iterations: int = 5,
                                   initial_blob_size: int = 3,
                                   blob_growth_rate: float = 1.5,
                                   irregularity: float = 0.3,
                                   background: Tuple[float, float, float] = (0.5, 0.5, 0.5)) -> list:
    """
    Iteratively transform the merged contour image into blobs.
    
    Each iteration:
    1. Extract contours for each color
    2. Transform contours to blobs
    3. Merge colored blobs
    4. Increase blob size for next iteration
    
    Args:
        merged_contours: Initial merged contour image (RGB)
        color1: First color (RGB, 0-1)
        color2: Second color (RGB, 0-1)
        num_iterations: Number of transformation steps
        initial_blob_size: Starting blob size
        blob_growth_rate: Multiplier for blob size each iteration
        irregularity: Blob shape irregularity
        background: Background color
        
    Returns:
        List of images showing the transformation progression
    """
    # Separate the two color channels from the merged image
    # Find pixels that match each color
    height, width = merged_contours.shape[:2]
    
    # Extract contours for each color
    contours1 = np.zeros((height, width), dtype=np.float32)
    contours2 = np.zeros((height, width), dtype=np.float32)
    
    # Threshold for color matching (allowing for some tolerance)
    color_tolerance = 0.1
    
    for y in range(height):
        for x in range(width):
            pixel = merged_contours[y, x]
            
            # Check if pixel matches color1
            match1 = all(abs(pixel[c] - color1[c]) < color_tolerance for c in range(3))
            # Check if pixel matches color2
            match2 = all(abs(pixel[c] - color2[c]) < color_tolerance for c in range(3))
            
            if match1:
                contours1[y, x] = 1.0
            elif match2:
                contours2[y, x] = 1.0
    
    # Store transformation steps
    transformation_steps = []
    
    current_blob_size = initial_blob_size
    
    for iteration in range(num_iterations):
        # Transform each set of contours to blobs
        blobs1 = contours_to_blobs(contours1, current_blob_size, irregularity)
        blobs2 = contours_to_blobs(contours2, current_blob_size, irregularity)
        
        # Color the blobs
        colored_blobs1 = color_contours(blobs1, color1, background)
        colored_blobs2 = color_contours(blobs2, color2, background)
        
        # Merge
        merged_blobs = merge_colored_contours(blobs1, color1, blobs2, color2, background)
        
        # Add to transformation steps
        transformation_steps.append(merged_blobs.copy())
        
        # Update contours for next iteration (use the blob masks as new contours)
        contours1 = blobs1.copy()
        contours2 = blobs2.copy()
        
        # Increase blob size for next iteration
        current_blob_size = int(current_blob_size * blob_growth_rate)
    
    return transformation_steps


def generate_bistable_image(image1_path: str, image2_path: str,
                           output_path: Optional[str] = None,
                           num_iterations: int = 5,
                           initial_blob_size: int = 3,
                           blob_growth_rate: float = 1.5,
                           irregularity: float = 0.3,
                           contour_threshold: float = 0.5,
                           contour_sigma: float = 1.0,
                           background_color: Tuple[float, float, float] = (0.5, 0.5, 0.5)) -> list:
    """
    Generate a bistable perception image from two input images.
    
    Args:
        image1_path: Path to first input image
        image2_path: Path to second input image
        output_path: Optional path to save final image
        num_iterations: Number of blob transformation iterations
        initial_blob_size: Starting size for blobs
        blob_growth_rate: Growth rate for blobs per iteration
        irregularity: Amount of blob shape irregularity
        contour_threshold: Threshold for edge detection
        contour_sigma: Sigma for Gaussian blur in edge detection
        background_color: Background color (RGB, 0-1)
        
    Returns:
        List of images showing the transformation progression
    """
    # Load images
    image1 = load_image(image1_path)
    image2 = load_image(image2_path)
    
    # Ensure images are the same size
    if image1.shape != image2.shape:
        # Resize to the smaller dimensions
        min_height = min(image1.shape[0], image2.shape[0])
        min_width = min(image1.shape[1], image2.shape[1])
        image1 = cv2.resize(image1, (min_width, min_height))
        image2 = cv2.resize(image2, (min_width, min_height))
    
    # Compute contours
    contours1 = compute_contours(image1, contour_threshold, contour_sigma)
    contours2 = compute_contours(image2, contour_threshold, contour_sigma)
    
    # Get complementary hues
    hsv_color1, hsv_color2 = get_complementary_hues()
    color1 = hsv_to_rgb(hsv_color1)
    color2 = hsv_to_rgb(hsv_color2)
    
    print(f"Color 1 (HSV): {hsv_color1} -> RGB: {color1}")
    print(f"Color 2 (HSV): {hsv_color2} -> RGB: {color2}")
    
    # Color the contours
    colored_contours1 = color_contours(contours1, color1, background_color)
    colored_contours2 = color_contours(contours2, color2, background_color)
    
    # Merge colored contours
    merged_contours = merge_colored_contours(contours1, color1, 
                                             contours2, color2, background_color)
    
    # Perform iterative transformation
    transformation_steps = iterative_blob_transformation(
        merged_contours, color1, color2,
        num_iterations=num_iterations,
        initial_blob_size=initial_blob_size,
        blob_growth_rate=blob_growth_rate,
        irregularity=irregularity,
        background=background_color
    )
    
    # Insert the initial contour image at the beginning
    transformation_steps.insert(0, merged_contours)
    
    # Save final image if output path is provided
    if output_path:
        final_image = transformation_steps[-1]
        final_image_uint8 = (final_image * 255).astype(np.uint8)
        cv2.imwrite(output_path, cv2.cvtColor(final_image_uint8, cv2.COLOR_RGB2BGR))
        print(f"Saved final image to {output_path}")
    
    return transformation_steps


def save_transformation_sequence(images: list, output_prefix: str, 
                                 output_dir: str = "output") -> list:
    """
    Save a sequence of transformation images.
    
    Args:
        images: List of images (RGB, 0-1)
        output_prefix: Prefix for output filenames
        output_dir: Directory to save images
        
    Returns:
        List of saved file paths
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    saved_paths = []
    
    for i, image in enumerate(images):
        filename = f"{output_prefix}_step_{i:03d}.png"
        filepath = Path(output_dir) / filename
        
        # Convert to uint8 and save
        image_uint8 = (image * 255).astype(np.uint8)
        cv2.imwrite(str(filepath), cv2.cvtColor(image_uint8, cv2.COLOR_RGB2BGR))
        saved_paths.append(str(filepath))
        print(f"Saved: {filepath}")
    
    return saved_paths


def main():
    parser = argparse.ArgumentParser(
        description="Generate bistable colored images from two input images"
    )
    parser.add_argument("--image1", required=True, help="Path to first input image")
    parser.add_argument("--image2", required=True, help="Path to second input image")
    parser.add_argument("--output", default="bistable_output.png", 
                       help="Output path for final image")
    parser.add_argument("--output-dir", default="output",
                       help="Directory to save transformation sequence")
    parser.add_argument("--iterations", type=int, default=5,
                       help="Number of blob transformation iterations")
    parser.add_argument("--blob-size", type=int, default=3,
                       help="Initial blob size")
    parser.add_argument("--growth-rate", type=float, default=1.5,
                       help="Blob growth rate per iteration")
    parser.add_argument("--irregularity", type=float, default=0.3,
                       help="Blob shape irregularity (0-1)")
    parser.add_argument("--threshold", type=float, default=0.5,
                       help="Edge detection threshold")
    parser.add_argument("--sigma", type=float, default=1.0,
                       help="Gaussian blur sigma for edge detection")
    parser.add_argument("--save-sequence", action="store_true",
                       help="Save all transformation steps")
    
    args = parser.parse_args()
    
    # Generate bistable image
    transformation_steps = generate_bistable_image(
        args.image1, args.image2,
        output_path=args.output,
        num_iterations=args.iterations,
        initial_blob_size=args.blob_size,
        blob_growth_rate=args.growth_rate,
        irregularity=args.irregularity,
        contour_threshold=args.threshold,
        contour_sigma=args.sigma
    )
    
    # Save sequence if requested
    if args.save_sequence:
        output_prefix = Path(args.output).stem
        save_transformation_sequence(
            transformation_steps, 
            output_prefix, 
            args.output_dir
        )
    
    print(f"Generated {len(transformation_steps)} transformation steps")
    print(f"Final image saved to {args.output}")


if __name__ == "__main__":
    main()
