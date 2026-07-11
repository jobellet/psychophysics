import os
import sys
import random
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from PIL import Image, ImageTk
import cv2
import numpy as np

# Ensure the script directory is in sys.path to import bistable_colored_images
script_dir = os.path.dirname(os.path.abspath(__file__))
if script_dir not in sys.path:
    sys.path.append(script_dir)

import bistable_colored_images


class BistableGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Bistable Colored Images Generator - Parameter Tester")
        self.root.geometry("1200x800")
        self.root.minsize(1000, 700)

        # Default paths to test_images
        default_img1 = os.path.join(script_dir, "test_images", "500px-Oryctolagus_cuniculus_Rcdo.jpg")
        default_img2 = os.path.join(script_dir, "test_images", "duck-2288380_1280.jpg")

        # Fallback to empty if not exists
        self.path_img1 = default_img1 if os.path.exists(default_img1) else ""
        self.path_img2 = default_img2 if os.path.exists(default_img2) else ""

        # State variables
        self.hsv_color1, self.hsv_color2 = bistable_colored_images.get_complementary_hues()
        self.transformation_steps = []
        self.current_step = 0
        
        # UI variables
        self.mode_var = tk.StringVar(value='dots')  # Default to dots mode
        
        # Blobs mode variables
        self.threshold_var = tk.DoubleVar(value=0.5)
        self.sigma_var = tk.DoubleVar(value=1.0)
        self.iterations_var = tk.IntVar(value=5)
        self.blob_size_var = tk.IntVar(value=3)
        self.growth_rate_var = tk.DoubleVar(value=1.5)
        self.irregularity_var = tk.DoubleVar(value=0.3)
        
        # Dots mode variables
        self.seg_method_var = tk.StringVar(value='otsu')  # otsu, adaptive, manual
        self.seg_threshold_var = tk.IntVar(value=127)
        self.seg_block_size_var = tk.IntVar(value=51)
        self.seg_C_var = tk.IntVar(value=10)
        self.seg_invert_var = tk.BooleanVar(value=False)
        
        self.dot_min_r_var = tk.DoubleVar(value=2.0)
        self.dot_max_r_var = tk.DoubleVar(value=10.0)
        self.dot_padding_var = tk.DoubleVar(value=1.0)
        self.dot_style_var = tk.StringVar(value='ishihara')  # ishihara, dalmatian
        
        # Dashes mode variables
        self.dash_spacing_var = tk.IntVar(value=12)
        self.dash_thickness_var = tk.IntVar(value=2)
        self.dash_length_var = tk.IntVar(value=10)
        
        # Voronoi mode variables
        self.voronoi_cells_var = tk.IntVar(value=800)
        
        # Organic blobs variables
        self.organic_blobs_count_var = tk.IntVar(value=1200)
        self.organic_blobs_min_var = tk.IntVar(value=4)
        self.organic_blobs_max_var = tk.IntVar(value=9)
        
        # Color previews
        self.color1_rgb = bistable_colored_images.hsv_to_rgb(self.hsv_color1)
        self.color2_rgb = bistable_colored_images.hsv_to_rgb(self.hsv_color2)

        # CLIP optimal overrides for Image 2
        self.opt_seg2 = None
        self._updating_from_clip = False

        # Clear CLIP overrides if user adjusts sliders/inputs manually
        def clear_clip_overrides(*args):
            if not getattr(self, '_updating_from_clip', False):
                self.opt_seg2 = None

        self.threshold_var.trace_add("write", clear_clip_overrides)
        self.sigma_var.trace_add("write", clear_clip_overrides)
        self.seg_method_var.trace_add("write", clear_clip_overrides)
        self.seg_threshold_var.trace_add("write", clear_clip_overrides)
        self.seg_block_size_var.trace_add("write", clear_clip_overrides)
        self.seg_C_var.trace_add("write", clear_clip_overrides)
        self.seg_invert_var.trace_add("write", clear_clip_overrides)

        self._build_ui()
        
        # Load and render initial state if images are set
        if self.path_img1 and self.path_img2:
            self.generate_images()

    def _build_ui(self):
        # Configure grid weight
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)

        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky="nsew")
        main_frame.columnconfigure(1, weight=1)
        main_frame.rowconfigure(0, weight=1)

        # Left panel: Controls (Width locked)
        controls_canvas = tk.Canvas(main_frame, width=320, highlightthickness=0)
        controls_canvas.grid(row=0, column=0, sticky="nsw", padx=(0, 10))
        
        scrollbar = ttk.Scrollbar(main_frame, orient="vertical", command=controls_canvas.yview)
        scrollbar.grid(row=0, column=0, sticky="nse", padx=(0, 10))
        controls_canvas.configure(yscrollcommand=scrollbar.set)
        
        controls_frame = ttk.Frame(controls_canvas, padding="5")
        controls_canvas.create_window((0, 0), window=controls_frame, anchor="nw")
        
        def on_configure(event):
            controls_canvas.configure(scrollregion=controls_canvas.bbox("all"))
        controls_frame.bind("<Configure>", on_configure)

        # Right panel: Display Area
        display_frame = ttk.Frame(main_frame)
        display_frame.grid(row=0, column=1, sticky="nsew")
        display_frame.columnconfigure(0, weight=1)
        display_frame.columnconfigure(1, weight=1)
        display_frame.rowconfigure(0, weight=1)
        display_frame.rowconfigure(1, weight=1)

        # Build display panels first (so self.img1_preview exists)
        self._build_display_widgets(display_frame)
        
        # Build controls
        self._build_control_widgets(controls_frame)

    def _build_control_widgets(self, parent):
        # --- Image Selection ---
        img_lf = ttk.LabelFrame(parent, text="Input Images", padding="10")
        img_lf.pack(fill="x", pady=(0, 10))

        # Image 1
        ttk.Label(img_lf, text="Image 1 (Color 1):").pack(anchor="w")
        img1_btn_frame = ttk.Frame(img_lf)
        img1_btn_frame.pack(fill="x", pady=2)
        self.img1_entry = ttk.Entry(img1_btn_frame)
        self.img1_entry.insert(0, self.path_img1)
        self.img1_entry.pack(side="left", fill="x", expand=True)
        ttk.Button(img1_btn_frame, text="Browse", command=self.browse_img1).pack(side="right", padx=(5, 0))

        # Image 2
        ttk.Label(img_lf, text="Image 2 (Color 2):").pack(anchor="w", pady=(5, 0))
        img2_btn_frame = ttk.Frame(img_lf)
        img2_btn_frame.pack(fill="x", pady=2)
        self.img2_entry = ttk.Entry(img2_btn_frame)
        self.img2_entry.insert(0, self.path_img2)
        self.img2_entry.pack(side="left", fill="x", expand=True)
        ttk.Button(img2_btn_frame, text="Browse", command=self.browse_img2).pack(side="right", padx=(5, 0))

        # --- Mode Selector ---
        mode_lf = ttk.LabelFrame(parent, text="Generator Mode", padding="10")
        mode_lf.pack(fill="x", pady=(0, 10))
        
        mode_cb = ttk.Combobox(mode_lf, textvariable=self.mode_var, values=["dots", "dashes", "voronoi", "organic_blobs", "blobs"], state="readonly")
        mode_cb.pack(fill="x")
        mode_cb.bind("<<ComboboxSelected>>", lambda e: self.toggle_mode_ui())
        
        # --- Parameters Container ---
        self.param_container = ttk.Frame(parent)
        self.param_container.pack(fill="x", pady=(0, 10))
        
        # 1. Blobs Frame
        self.blobs_frame = ttk.LabelFrame(self.param_container, text="Blobs Parameters", padding="10")
        
        # Edge Threshold
        ttk.Label(self.blobs_frame, text="Contour Edge Threshold:").pack(anchor="w")
        ttk.Scale(self.blobs_frame, from_=0.01, to=1.0, variable=self.threshold_var, orient="horizontal", command=self.update_contours_preview).pack(fill="x", pady=(0, 5))
        self.threshold_label = ttk.Label(self.blobs_frame, text="0.50")
        self.threshold_label.pack(anchor="e")
        self.threshold_var.trace_add("write", lambda *args: self.threshold_label.configure(text=f"{self.threshold_var.get():.2f}"))

        # Sigma
        ttk.Label(self.blobs_frame, text="Gaussian Sigma:").pack(anchor="w", pady=(5, 0))
        ttk.Scale(self.blobs_frame, from_=0.1, to=5.0, variable=self.sigma_var, orient="horizontal", command=self.update_contours_preview).pack(fill="x", pady=(0, 5))
        self.sigma_label = ttk.Label(self.blobs_frame, text="1.00")
        self.sigma_label.pack(anchor="e")
        self.sigma_var.trace_add("write", lambda *args: self.sigma_label.configure(text=f"{self.sigma_var.get():.2f}"))

        # Iterations
        ttk.Label(self.blobs_frame, text="Blob Iterations:").pack(anchor="w", pady=(5, 0))
        ttk.Scale(self.blobs_frame, from_=1, to=10, variable=self.iterations_var, orient="horizontal").pack(fill="x", pady=(0, 5))
        self.iterations_label = ttk.Label(self.blobs_frame, text="5")
        self.iterations_label.pack(anchor="e")
        self.iterations_var.trace_add("write", lambda *args: self.iterations_label.configure(text=f"{self.iterations_var.get()}"))

        # Initial Blob Size
        ttk.Label(self.blobs_frame, text="Initial Blob Size (px):").pack(anchor="w", pady=(5, 0))
        ttk.Scale(self.blobs_frame, from_=1, to=20, variable=self.blob_size_var, orient="horizontal").pack(fill="x", pady=(0, 5))
        self.blob_size_label = ttk.Label(self.blobs_frame, text="3")
        self.blob_size_label.pack(anchor="e")
        self.blob_size_var.trace_add("write", lambda *args: self.blob_size_label.configure(text=f"{self.blob_size_var.get()}"))

        # Growth Rate
        ttk.Label(self.blobs_frame, text="Blob Growth Rate (per iter):").pack(anchor="w", pady=(5, 0))
        ttk.Scale(self.blobs_frame, from_=1.0, to=3.0, variable=self.growth_rate_var, orient="horizontal").pack(fill="x", pady=(0, 5))
        self.growth_rate_label = ttk.Label(self.blobs_frame, text="1.50")
        self.growth_rate_label.pack(anchor="e")
        self.growth_rate_var.trace_add("write", lambda *args: self.growth_rate_label.configure(text=f"{self.growth_rate_var.get():.2f}"))

        # Irregularity
        ttk.Label(self.blobs_frame, text="Blob Irregularity:").pack(anchor="w", pady=(5, 0))
        ttk.Scale(self.blobs_frame, from_=0.0, to=1.0, variable=self.irregularity_var, orient="horizontal").pack(fill="x", pady=(0, 5))
        self.irregularity_label = ttk.Label(self.blobs_frame, text="0.30")
        self.irregularity_label.pack(anchor="e")
        self.irregularity_var.trace_add("write", lambda *args: self.irregularity_label.configure(text=f"{self.irregularity_var.get():.2f}"))

        # 2. Dots Frame
        self.dots_frame = ttk.LabelFrame(self.param_container, text="Dots Parameters", padding="10")
        
        # Segmentation Method
        ttk.Label(self.dots_frame, text="Silhouette Method:").pack(anchor="w")
        seg_cb = ttk.Combobox(self.dots_frame, textvariable=self.seg_method_var, values=["otsu", "adaptive", "manual"], state="readonly")
        seg_cb.pack(fill="x", pady=(0, 5))
        seg_cb.bind("<<ComboboxSelected>>", lambda e: self.update_contours_preview())
        
        # Invert masks checkbox
        ttk.Checkbutton(self.dots_frame, text="Invert Silhouettes", variable=self.seg_invert_var, command=self.update_contours_preview).pack(anchor="w", pady=(0, 5))

        # Manual Threshold
        ttk.Label(self.dots_frame, text="Manual Threshold (0-255):").pack(anchor="w")
        ttk.Scale(self.dots_frame, from_=1, to=254, variable=self.seg_threshold_var, orient="horizontal", command=self.update_contours_preview).pack(fill="x", pady=(0, 5))
        self.seg_threshold_label = ttk.Label(self.dots_frame, text="127")
        self.seg_threshold_label.pack(anchor="e")
        self.seg_threshold_var.trace_add("write", lambda *args: self.seg_threshold_label.configure(text=f"{self.seg_threshold_var.get()}"))

        # Dot Min Radius
        ttk.Label(self.dots_frame, text="Min Circle Radius:").pack(anchor="w", pady=(5, 0))
        ttk.Scale(self.dots_frame, from_=1.0, to=10.0, variable=self.dot_min_r_var, orient="horizontal").pack(fill="x", pady=(0, 5))
        self.dot_min_r_label = ttk.Label(self.dots_frame, text="2.00")
        self.dot_min_r_label.pack(anchor="e")
        self.dot_min_r_var.trace_add("write", lambda *args: self.dot_min_r_label.configure(text=f"{self.dot_min_r_var.get():.2f}"))

        # Dot Max Radius
        ttk.Label(self.dots_frame, text="Max Circle Radius:").pack(anchor="w", pady=(5, 0))
        ttk.Scale(self.dots_frame, from_=3.0, to=30.0, variable=self.dot_max_r_var, orient="horizontal").pack(fill="x", pady=(0, 5))
        self.dot_max_r_label = ttk.Label(self.dots_frame, text="10.00")
        self.dot_max_r_label.pack(anchor="e")
        self.dot_max_r_var.trace_add("write", lambda *args: self.dot_max_r_label.configure(text=f"{self.dot_max_r_var.get():.2f}"))

        # Dot Padding
        ttk.Label(self.dots_frame, text="Circle Spacing/Padding:").pack(anchor="w", pady=(5, 0))
        ttk.Scale(self.dots_frame, from_=0.0, to=5.0, variable=self.dot_padding_var, orient="horizontal").pack(fill="x", pady=(0, 5))
        self.dot_padding_label = ttk.Label(self.dots_frame, text="1.00")
        self.dot_padding_label.pack(anchor="e")
        self.dot_padding_var.trace_add("write", lambda *args: self.dot_padding_label.configure(text=f"{self.dot_padding_var.get():.2f}"))

        # Visual Style
        ttk.Label(self.dots_frame, text="Dot Visual Style:").pack(anchor="w", pady=(5, 0))
        style_cb = ttk.Combobox(self.dots_frame, textvariable=self.dot_style_var, values=["ishihara", "dalmatian"], state="readonly")
        style_cb.pack(fill="x", pady=(0, 5))

        # 3. Dashes Frame
        self.dashes_frame = ttk.LabelFrame(self.param_container, text="Dashes Parameters", padding="10")
        
        # Dash Spacing
        ttk.Label(self.dashes_frame, text="Dash Spacing/Grid:").pack(anchor="w")
        ttk.Scale(self.dashes_frame, from_=6, to=24, variable=self.dash_spacing_var, orient="horizontal").pack(fill="x", pady=(0, 5))
        self.dash_spacing_label = ttk.Label(self.dashes_frame, text="12")
        self.dash_spacing_label.pack(anchor="e")
        self.dash_spacing_var.trace_add("write", lambda *args: self.dash_spacing_label.configure(text=f"{self.dash_spacing_var.get()}"))

        # Dash Thickness
        ttk.Label(self.dashes_frame, text="Dash Thickness (px):").pack(anchor="w", pady=(5, 0))
        ttk.Scale(self.dashes_frame, from_=1, to=8, variable=self.dash_thickness_var, orient="horizontal").pack(fill="x", pady=(0, 5))
        self.dash_thickness_label = ttk.Label(self.dashes_frame, text="2")
        self.dash_thickness_label.pack(anchor="e")
        self.dash_thickness_var.trace_add("write", lambda *args: self.dash_thickness_label.configure(text=f"{self.dash_thickness_var.get()}"))

        # Dash Length
        ttk.Label(self.dashes_frame, text="Dash Length (px):").pack(anchor="w", pady=(5, 0))
        ttk.Scale(self.dashes_frame, from_=4, to=30, variable=self.dash_length_var, orient="horizontal").pack(fill="x", pady=(0, 5))
        self.dash_length_label = ttk.Label(self.dashes_frame, text="10")
        self.dash_length_label.pack(anchor="e")
        self.dash_length_var.trace_add("write", lambda *args: self.dash_length_label.configure(text=f"{self.dash_length_var.get()}"))

        # 4. Voronoi Frame
        self.voronoi_frame = ttk.LabelFrame(self.param_container, text="Voronoi Parameters", padding="10")
        
        # Cell count
        ttk.Label(self.voronoi_frame, text="Number of Cells:").pack(anchor="w")
        ttk.Scale(self.voronoi_frame, from_=100, to=2000, variable=self.voronoi_cells_var, orient="horizontal").pack(fill="x", pady=(0, 5))
        self.voronoi_cells_label = ttk.Label(self.voronoi_frame, text="800")
        self.voronoi_cells_label.pack(anchor="e")
        self.voronoi_cells_var.trace_add("write", lambda *args: self.voronoi_cells_label.configure(text=f"{self.voronoi_cells_var.get()}"))

        # 5. Organic Blobs Frame
        self.organic_blobs_frame = ttk.LabelFrame(self.param_container, text="Organic Blobs Parameters", padding="10")
        
        # Blob Count
        ttk.Label(self.organic_blobs_frame, text="Blob Count:").pack(anchor="w")
        ttk.Scale(self.organic_blobs_frame, from_=100, to=3000, variable=self.organic_blobs_count_var, orient="horizontal").pack(fill="x", pady=(0, 5))
        self.organic_blobs_count_label = ttk.Label(self.organic_blobs_frame, text="1200")
        self.organic_blobs_count_label.pack(anchor="e")
        self.organic_blobs_count_var.trace_add("write", lambda *args: self.organic_blobs_count_label.configure(text=f"{self.organic_blobs_count_var.get()}"))

        # Min size
        ttk.Label(self.organic_blobs_frame, text="Min Blob Radius:").pack(anchor="w", pady=(5, 0))
        ttk.Scale(self.organic_blobs_frame, from_=1, to=20, variable=self.organic_blobs_min_var, orient="horizontal").pack(fill="x", pady=(0, 5))
        self.organic_blobs_min_label = ttk.Label(self.organic_blobs_frame, text="4")
        self.organic_blobs_min_label.pack(anchor="e")
        self.organic_blobs_min_var.trace_add("write", lambda *args: self.organic_blobs_min_label.configure(text=f"{self.organic_blobs_min_var.get()}"))

        # Max size
        ttk.Label(self.organic_blobs_frame, text="Max Blob Radius:").pack(anchor="w", pady=(5, 0))
        ttk.Scale(self.organic_blobs_frame, from_=2, to=40, variable=self.organic_blobs_max_var, orient="horizontal").pack(fill="x", pady=(0, 5))
        self.organic_blobs_max_label = ttk.Label(self.organic_blobs_frame, text="9")
        self.organic_blobs_max_label.pack(anchor="e")
        self.organic_blobs_max_var.trace_add("write", lambda *args: self.organic_blobs_max_label.configure(text=f"{self.organic_blobs_max_var.get()}"))

        # Show initial mode UI
        self.toggle_mode_ui()

        # --- Colors ---
        color_lf = ttk.LabelFrame(parent, text="Complementary Colors", padding="10")
        color_lf.pack(fill="x", pady=(0, 10))
        
        self.color_canvas = tk.Canvas(color_lf, height=40, bg="gray")
        self.color_canvas.pack(fill="x", pady=5)
        self.draw_color_previews()

        ttk.Button(color_lf, text="Randomize Colors", command=self.randomize_colors).pack(fill="x")

        # --- Actions ---
        ttk.Button(parent, text="Generate Bistable Output", command=self.generate_images).pack(fill="x", pady=(0, 5))
        
        self.clip_opt_btn = ttk.Button(parent, text="Auto-Optimize Parameters (CLIP)", command=self.start_clip_optimization)
        self.clip_opt_btn.pack(fill="x", pady=(0, 5))
        
        # Save frame
        save_frame = ttk.Frame(parent)
        save_frame.pack(fill="x")
        ttk.Button(save_frame, text="Save Selected Step", command=self.save_current_step).pack(side="left", fill="x", expand=True, padx=(0, 2))
        ttk.Button(save_frame, text="Save All Steps", command=self.save_all_steps).pack(side="right", fill="x", expand=True, padx=(2, 0))

    def _build_display_widgets(self, parent):
        # Row 0: Image 1 and Image 2 previews
        img1_frame = ttk.LabelFrame(parent, text="Image 1 & Contours", padding="5")
        img1_frame.grid(row=0, column=0, sticky="nsew", padx=5, pady=5)
        img1_frame.columnconfigure(0, weight=1)
        img1_frame.rowconfigure(0, weight=1)
        self.img1_preview = ttk.Label(img1_frame, text="Load Image 1", anchor="center")
        self.img1_preview.grid(row=0, column=0, sticky="nsew")

        img2_frame = ttk.LabelFrame(parent, text="Image 2 & Contours", padding="5")
        img2_frame.grid(row=0, column=1, sticky="nsew", padx=5, pady=5)
        img2_frame.columnconfigure(0, weight=1)
        img2_frame.rowconfigure(0, weight=1)
        self.img2_preview = ttk.Label(img2_frame, text="Load Image 2", anchor="center")
        self.img2_preview.grid(row=0, column=0, sticky="nsew")

        # Row 1: Merged Output step view
        output_frame = ttk.LabelFrame(parent, text="Bistable Output (Step Progression)", padding="5")
        output_frame.grid(row=1, column=0, columnspan=2, sticky="nsew", padx=5, pady=5)
        output_frame.columnconfigure(0, weight=1)
        output_frame.rowconfigure(0, weight=1)

        self.output_preview = ttk.Label(output_frame, text="Generate to see output", anchor="center")
        self.output_preview.grid(row=0, column=0, sticky="nsew")

        # Step slider below output
        slider_frame = ttk.Frame(output_frame)
        slider_frame.grid(row=1, column=0, sticky="ew", pady=5)
        slider_frame.columnconfigure(1, weight=1)

        ttk.Label(slider_frame, text="Step:").grid(row=0, column=0, padx=5)
        self.step_slider = ttk.Scale(slider_frame, from_=0, to=0, orient="horizontal", command=self.on_step_changed)
        self.step_slider.grid(row=0, column=1, sticky="ew", padx=5)
        self.step_label = ttk.Label(slider_frame, text="0 / 0")
        self.step_label.grid(row=0, column=2, padx=5)

    def draw_color_previews(self):
        self.color_canvas.delete("all")
        self.root.update_idletasks()
        w = self.color_canvas.winfo_width()
        h = self.color_canvas.winfo_height()
        if w < 10:  # If window not drawn yet
            w = 300
        
        c1 = tuple(int(x * 255) for x in self.color1_rgb)
        c2 = tuple(int(x * 255) for x in self.color2_rgb)
        
        hex1 = f"#{c1[0]:02x}{c1[1]:02x}{c1[2]:02x}"
        hex2 = f"#{c2[0]:02x}{c2[1]:02x}{c2[2]:02x}"
        
        self.color_canvas.create_rectangle(0, 0, w // 2, h, fill=hex1, outline="")
        self.color_canvas.create_text(w // 4, h // 2, text="Color 1", fill="black" if sum(c1)/3 > 128 else "white")
        
        self.color_canvas.create_rectangle(w // 2, 0, w, h, fill=hex2, outline="")
        self.color_canvas.create_text(3 * w // 4, h // 2, text="Color 2", fill="black" if sum(c2)/3 > 128 else "white")

    def randomize_colors(self):
        self.hsv_color1, self.hsv_color2 = bistable_colored_images.get_complementary_hues()
        self.color1_rgb = bistable_colored_images.hsv_to_rgb(self.hsv_color1)
        self.color2_rgb = bistable_colored_images.hsv_to_rgb(self.hsv_color2)
        self.draw_color_previews()
        if len(self.transformation_steps) > 0:
            self.generate_images()

    def browse_img1(self):
        path = filedialog.askopenfilename(filetypes=[("Image files", "*.jpg *.jpeg *.png *.bmp")])
        if path:
            self.path_img1 = path
            self.img1_entry.delete(0, tk.END)
            self.img1_entry.insert(0, path)
            self.update_contours_preview()

    def browse_img2(self):
        path = filedialog.askopenfilename(filetypes=[("Image files", "*.jpg *.jpeg *.png *.bmp")])
        if path:
            self.path_img2 = path
            self.img2_entry.delete(0, tk.END)
            self.img2_entry.insert(0, path)
            self.update_contours_preview()

    def load_and_resize_to_preview(self, path, max_width=400, max_height=300):
        if not path or not os.path.exists(path):
            return None, None
        img = cv2.imread(path)
        if img is None:
            return None, None
        h, w = img.shape[:2]
        scale = min(max_width / w, max_height / h)
        if scale < 1.0:
            img = cv2.resize(img, (int(w * scale), int(h * scale)))
        return img, cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    def toggle_mode_ui(self):
        mode = self.mode_var.get()
        self.blobs_frame.pack_forget()
        self.dots_frame.pack_forget()
        self.dashes_frame.pack_forget()
        self.voronoi_frame.pack_forget()
        self.organic_blobs_frame.pack_forget()
        
        if mode == 'dots':
            self.dots_frame.pack(fill="x", expand=True)
        elif mode == 'dashes':
            self.dashes_frame.pack(fill="x", expand=True)
        elif mode == 'voronoi':
            self.voronoi_frame.pack(fill="x", expand=True)
        elif mode == 'organic_blobs':
            self.organic_blobs_frame.pack(fill="x", expand=True)
        else:
            self.blobs_frame.pack(fill="x", expand=True)
            
        # Update preview headers/labels dynamically
        self.update_contours_preview()

    def update_contours_preview(self, *args):
        # Read paths
        p1 = self.img1_entry.get().strip()
        p2 = self.img2_entry.get().strip()
        
        mode = self.mode_var.get()

        img1_gray, img2_gray = None, None
        
        # Load images if paths are valid
        if p1 and os.path.exists(p1):
            try:
                img1_gray = bistable_colored_images.load_image(p1)
            except Exception:
                pass
        if p2 and os.path.exists(p2):
            try:
                img2_gray = bistable_colored_images.load_image(p2)
            except Exception:
                pass

        # Perform crop and resize
        if img1_gray is not None and img2_gray is not None:
            try:
                img1_gray, img2_gray = bistable_colored_images.crop_and_resize(img1_gray, img2_gray)
            except Exception:
                pass
        else:
            # If only one image is loaded, center crop it to a square of its own minimum dimension
            if img1_gray is not None:
                h, w = img1_gray.shape[:2]
                min_dim = min(h, w)
                sy, sx = (h - min_dim) // 2, (w - min_dim) // 2
                img1_gray = img1_gray[sy:sy+min_dim, sx:sx+min_dim]
            if img2_gray is not None:
                h, w = img2_gray.shape[:2]
                min_dim = min(h, w)
                sy, sx = (h - min_dim) // 2, (w - min_dim) // 2
                img2_gray = img2_gray[sy:sy+min_dim, sx:sx+min_dim]

        # Update Image 1 Preview
        if img1_gray is not None:
            try:
                if mode in ['dots', 'dashes', 'voronoi', 'organic_blobs']:
                    m1 = bistable_colored_images.compute_silhouette(
                        img1_gray, 
                        method=self.seg_method_var.get(),
                        threshold_value=self.seg_threshold_var.get(),
                        invert=self.seg_invert_var.get()
                    )
                    disp = cv2.cvtColor(m1, cv2.COLOR_GRAY2RGB)
                else:
                    contours1 = bistable_colored_images.compute_contours(img1_gray, self.threshold_var.get(), self.sigma_var.get())
                    c1_uint8 = (contours1 * 255).astype(np.uint8)
                    disp = cv2.cvtColor(img1_gray, cv2.COLOR_GRAY2RGB)
                    disp[c1_uint8 > 0] = [255, 0, 0] # red contour
                
                h, w = disp.shape[:2]
                max_w, max_h = 400, 300
                scale = min(max_w / w, max_h / h)
                if scale < 1.0:
                    disp = cv2.resize(disp, (int(w * scale), int(h * scale)))
                    
                pil_img = Image.fromarray(disp)
                tk_img = ImageTk.PhotoImage(image=pil_img)
                self.img1_preview.configure(image=tk_img, text="")
                self.img1_preview.image = tk_img
            except Exception as e:
                self.img1_preview.configure(text=f"Error: {str(e)}", image="")
        else:
            self.img1_preview.configure(text="Please load Image 1", image="")

        # Update Image 2 Preview
        if img2_gray is not None:
            try:
                if mode in ['dots', 'dashes', 'voronoi', 'organic_blobs']:
                    if getattr(self, 'opt_seg2', None) is not None:
                        sm2 = self.opt_seg2.get('seg_method')
                        st2 = self.opt_seg2.get('seg_threshold')
                        si2 = self.opt_seg2.get('seg_invert')
                        sb2 = self.opt_seg2.get('seg_block_size', 51)
                        sc2 = self.opt_seg2.get('seg_C', 10)
                    else:
                        sm2 = self.seg_method_var.get()
                        st2 = self.seg_threshold_var.get()
                        si2 = self.seg_invert_var.get()
                        sb2 = 51
                        sc2 = 10
                        
                    m2 = bistable_colored_images.compute_silhouette(
                        img2_gray, 
                        method=sm2, 
                        threshold_value=st2, 
                        invert=si2,
                        block_size=sb2,
                        C=sc2
                    )
                    disp = cv2.cvtColor(m2, cv2.COLOR_GRAY2RGB)
                else:
                    if getattr(self, 'opt_seg2', None) is not None:
                        ct2 = self.opt_seg2.get('threshold')
                        cs2 = self.opt_seg2.get('sigma')
                    else:
                        ct2 = self.threshold_var.get()
                        cs2 = self.sigma_var.get()
                        
                    contours2 = bistable_colored_images.compute_contours(img2_gray, ct2, cs2)
                    c2_uint8 = (contours2 * 255).astype(np.uint8)
                    disp = cv2.cvtColor(img2_gray, cv2.COLOR_GRAY2RGB)
                    disp[c2_uint8 > 0] = [0, 255, 0] # green contour
                
                h, w = disp.shape[:2]
                max_w, max_h = 400, 300
                scale = min(max_w / w, max_h / h)
                if scale < 1.0:
                    disp = cv2.resize(disp, (int(w * scale), int(h * scale)))
                    
                pil_img = Image.fromarray(disp)
                tk_img = ImageTk.PhotoImage(image=pil_img)
                self.img2_preview.configure(image=tk_img, text="")
                self.img2_preview.image = tk_img
            except Exception as e:
                self.img2_preview.configure(text=f"Error: {str(e)}", image="")
        else:
            self.img2_preview.configure(text="Please load Image 2", image="")

    def generate_images(self):
        p1 = self.img1_entry.get().strip()
        p2 = self.img2_entry.get().strip()
        
        if not p1 or not p2 or not os.path.exists(p1) or not os.path.exists(p2):
            messagebox.showerror("Error", "Please select valid paths for both Image 1 and Image 2.")
            return

        # Update status
        self.output_preview.configure(text="Generating... please wait.", image="")
        self.root.update_idletasks()

        try:
            # Generate using options
            kwargs = {
                'output_path': None,
                'mode': self.mode_var.get(),
                'num_iterations': self.iterations_var.get(),
                'initial_blob_size': self.blob_size_var.get(),
                'blob_growth_rate': self.growth_rate_var.get(),
                'irregularity': self.irregularity_var.get(),
                'contour_threshold': self.threshold_var.get(),
                'contour_sigma': self.sigma_var.get(),
                'seg_method': self.seg_method_var.get(),
                'seg_threshold': self.seg_threshold_var.get(),
                'dot_min_r': self.dot_min_r_var.get(),
                'dot_max_r': self.dot_max_r_var.get(),
                'dot_padding': self.dot_padding_var.get(),
                'dot_style': self.dot_style_var.get(),
                'dash_spacing': self.dash_spacing_var.get(),
                'dash_thickness': self.dash_thickness_var.get(),
                'dash_length': self.dash_length_var.get(),
                'voronoi_cells': self.voronoi_cells_var.get(),
                'organic_blobs_count': self.organic_blobs_count_var.get(),
                'organic_blobs_min': self.organic_blobs_min_var.get(),
                'organic_blobs_max': self.organic_blobs_max_var.get(),
                'color1_hsv': self.hsv_color1,
                'color2_hsv': self.hsv_color2
            }
            
            if getattr(self, 'opt_seg2', None) is not None:
                if self.mode_var.get() in ['dots', 'dashes', 'voronoi', 'organic_blobs']:
                    kwargs.update({
                        'seg_method2': self.opt_seg2.get('seg_method'),
                        'seg_threshold2': self.opt_seg2.get('seg_threshold'),
                        'seg_block_size2': self.opt_seg2.get('seg_block_size'),
                        'seg_C2': self.opt_seg2.get('seg_C'),
                        'seg_invert2': self.opt_seg2.get('seg_invert')
                    })
                else:
                    kwargs.update({
                        'contour_threshold2': self.opt_seg2.get('threshold'),
                        'contour_sigma2': self.opt_seg2.get('sigma')
                    })
            
            steps = bistable_colored_images.generate_bistable_image(p1, p2, **kwargs)
            self.transformation_steps = steps
            
            # Setup slider
            num_steps = len(steps)
            self.step_slider.configure(from_=0, to=num_steps - 1)
            self.step_slider.set(num_steps - 1)
            self.current_step = num_steps - 1
            self.step_label.configure(text=f"{self.current_step} / {num_steps - 1}")
            
            # Show output
            self.render_step(self.current_step)
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.output_preview.configure(text=f"Error generating: {str(e)}", image="")
            messagebox.showerror("Error", f"An error occurred during generation:\n{str(e)}")

    def render_step(self, step_idx):
        if not self.transformation_steps or step_idx < 0 or step_idx >= len(self.transformation_steps):
            return
        
        img = self.transformation_steps[step_idx]
        img_uint8 = (img * 255).astype(np.uint8)
        
        h, w = img_uint8.shape[:2]
        
        # Fit inside preview
        max_w, max_h = 700, 400
        scale = min(max_w / w, max_h / h)
        if scale < 1.0:
            img_uint8 = cv2.resize(img_uint8, (int(w * scale), int(h * scale)))
            
        pil_img = Image.fromarray(img_uint8)
        tk_img = ImageTk.PhotoImage(image=pil_img)
        self.output_preview.configure(image=tk_img, text="")
        self.output_preview.image = tk_img

    def on_step_changed(self, val):
        idx = int(float(val))
        if idx != self.current_step:
            self.current_step = idx
            self.step_label.configure(text=f"{self.current_step} / {len(self.transformation_steps) - 1}")
            self.render_step(self.current_step)

    def save_current_step(self):
        if not self.transformation_steps:
            messagebox.showerror("Error", "No output generated to save yet.")
            return
        path = filedialog.asksaveasfilename(defaultextension=".png", filetypes=[("PNG files", "*.png"), ("All files", "*.*")])
        if path:
            img = self.transformation_steps[self.current_step]
            img_uint8 = (img * 255).astype(np.uint8)
            cv2.imwrite(path, cv2.cvtColor(img_uint8, cv2.COLOR_RGB2BGR))
            messagebox.showinfo("Success", f"Saved step {self.current_step} to {path}")

    def save_all_steps(self):
        if not self.transformation_steps:
            messagebox.showerror("Error", "No output generated to save yet.")
            return
        dir_path = filedialog.askdirectory(title="Select Output Directory")
        if dir_path:
            prefix = "bistable"
            bistable_colored_images.save_transformation_sequence(
                self.transformation_steps, prefix, dir_path
            )
            messagebox.showinfo("Success", f"Saved {len(self.transformation_steps)} steps to {dir_path}")


    def start_clip_optimization(self):
        if not bistable_colored_images.CLIP_AVAILABLE:
            messagebox.showerror("CLIP Not Available", 
                                 "CLIP is not available in the current environment!\n\n"
                                 "Please run the GUI with the Conda environment:\n"
                                 "C:\\Users\\joach\\anaconda3\\envs\\predict_saccade\\python.exe synthetic_stimuli/bistable_gui.py")
            return
            
        p1 = self.img1_entry.get().strip()
        p2 = self.img2_entry.get().strip()
        if not p1 or not p2 or not os.path.exists(p1) or not os.path.exists(p2):
            messagebox.showerror("Error", "Please select valid paths for both Image 1 and Image 2.")
            return

        self.clip_opt_btn.configure(state="disabled", text="Optimizing with CLIP...")
        self.root.update_idletasks()
        
        # Start optimization in a background thread to keep UI responsive
        import threading
        thread = threading.Thread(target=self.run_clip_optimization_thread, args=(p1, p2))
        thread.daemon = True
        thread.start()
        
    def run_clip_optimization_thread(self, p1, p2):
        try:
            mode = self.mode_var.get()
            
            # 1. Optimize segmentation for Image 1 and Image 2
            best_s1 = bistable_colored_images.optimize_segmentation_with_clip(p1, mode, self.hsv_color1)
            best_s2 = bistable_colored_images.optimize_segmentation_with_clip(p2, mode, self.hsv_color2)
            
            # 2. Optimize generation parameters
            best_gen = bistable_colored_images.optimize_generation_with_clip(
                p1, p2, mode, self.hsv_color1, self.hsv_color2, best_s1, best_s2
            )
            
            # Schedule GUI updates in the main thread
            self.root.after(0, lambda: self.apply_optimized_parameters(best_s1, best_s2, best_gen))
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.root.after(0, lambda: self.on_optimization_error(str(e)))
            
    def apply_optimized_parameters(self, best_s1, best_s2, best_gen):
        self.clip_opt_btn.configure(state="normal", text="Auto-Optimize Parameters (CLIP)")
        
        # Disable manual override trigger during updates
        self._updating_from_clip = True
        
        try:
            mode = self.mode_var.get()
            if mode in ['dots', 'dashes', 'voronoi', 'organic_blobs']:
                self.seg_method_var.set(best_s1['seg_method'])
                self.seg_threshold_var.set(best_s1['seg_threshold'])
                self.seg_block_size_var.set(best_s1['seg_block_size'])
                self.seg_C_var.set(best_s1['seg_C'])
                self.seg_invert_var.set(best_s1['seg_invert'])
                
                if mode == 'dots':
                    self.dot_min_r_var.set(best_gen['dot_min_r'])
                    self.dot_max_r_var.set(best_gen['dot_max_r'])
                    self.dot_padding_var.set(best_gen['dot_padding'])
                elif mode == 'dashes':
                    self.dash_spacing_var.set(best_gen['dash_spacing'])
                    self.dash_thickness_var.set(best_gen['dash_thickness'])
                    self.dash_length_var.set(best_gen['dash_length'])
                elif mode == 'voronoi':
                    self.voronoi_cells_var.set(best_gen['voronoi_cells'])
                elif mode == 'organic_blobs':
                    self.organic_blobs_count_var.set(best_gen['organic_blobs_count'])
                    self.organic_blobs_min_var.set(best_gen['organic_blobs_min'])
                    self.organic_blobs_max_var.set(best_gen['organic_blobs_max'])
            else:
                self.threshold_var.set(best_s1['threshold'])
                self.sigma_var.set(best_s1['sigma'])
                
                self.iterations_var.set(best_gen['iterations'])
                self.blob_size_var.set(best_gen['blob_size'])
                self.growth_rate_var.set(best_gen['growth_rate'])
                self.irregularity_var.set(best_gen['irregularity'])
                
            # Store Image 2 optimal overrides
            self.opt_seg2 = best_s2
            
            # Trigger update of preview and regenerate final output
            self.update_contours_preview()
            self.generate_images()
            
            messagebox.showinfo("CLIP Optimization Success", 
                                "Successfully auto-optimized parameters with CLIP!\n\n"
                                f"Image 1 Seg: {best_s1}\n"
                                f"Image 2 Seg: {best_s2}\n"
                                f"Generation: {best_gen}")
        finally:
            self._updating_from_clip = False
                            
    def on_optimization_error(self, err_msg):
        self.clip_opt_btn.configure(state="normal", text="Auto-Optimize Parameters (CLIP)")
        messagebox.showerror("CLIP Optimization Error", f"An error occurred during optimization:\n{err_msg}")


if __name__ == "__main__":
    root = tk.Tk()
    app = BistableGUI(root)
    
    # Set window icon / preview correctly first time
    root.update()
    app.draw_color_previews()
    
    # Run the Tkinter main loop
    root.mainloop()
