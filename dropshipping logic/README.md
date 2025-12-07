# Dropshipping Detector with AI Stock Image Classification

A comprehensive dropshipping detection system that analyzes websites using:
- **Image Analysis**: AI-powered stock image detection + pHash matching
- **Text Analysis**: Keyword detection in product descriptions
- **Price Analysis**: Suspicious price pattern detection
- **Web Scraping**: BeautifulSoup-based data extraction

## Features

### 🤖 AI Stock Image Detection
- CNN-based classifier to detect stock images vs original product photos
- Uses transfer learning with ResNet18 backbone
- Trained on your custom dataset

### 🔍 Multi-Method Detection
- **pHash matching**: Compares images against known dropshipping product database
- **AI classification**: Detects generic stock images commonly used in dropshipping
- **Text analysis**: Identifies dropshipping keywords in descriptions
- **Price analysis**: Flags suspiciously low prices

## Installation

1. **Install dependencies:**
```bash
pip install -r requirements.txt
```

2. **Prepare training data** (for AI model):
   - Create directory structure:
   ```
   data/
     stock/
       image1.jpg
       image2.jpg
       ...
     original/
       image1.jpg
       image2.jpg
       ...
   ```

3. **Train the AI model** (optional, but recommended):
```bash
python train_model.py --data_dir data --epochs 10 --batch_size 32
```

## Usage

### Basic Usage

```python
from analysis import run_dropshipping_detector

# Analyze a single URL
result = run_dropshipping_detector("https://example-shop.com/product")

print(f"Score: {result['score']}")
print(f"Status: {result['status']}")
print(f"Stock images detected: {result['stock_images']}")
```

### Batch Analysis

```python
from main import analyze_user_list

urls = [
    "https://shop1.com/product1",
    "https://shop2.com/product2",
    "https://shop3.com/product3"
]

results = analyze_user_list(urls)
```

### Training the AI Model

1. **Collect training data:**
```bash
# Setup directory structure
python collect_data.py --setup

# Download stock images (example)
python collect_data.py --download_stock <url1> <url2> ...

# Download original images (example)
python collect_data.py --download_original <url1> <url2> ...
```

2. **Train the model:**
```bash
python train_model.py --data_dir data --epochs 10 --batch_size 32 --lr 0.001
```

The trained model will be saved to `models/stock_image_classifier.pth`

## Project Structure

```
.
├── main.py                 # Main entry point for batch analysis
├── analysis.py             # Core detection logic (AI + pHash + text + price)
├── extract.py              # Web scraping with BeautifulSoup
├── config.py               # Configuration settings
├── image_classifier.py     # AI model definition and inference
├── train_model.py          # Training script for AI model
├── collect_data.py         # Data collection utilities
├── requirements.txt        # Python dependencies
├── models/                 # Trained models (created after training)
└── data/                   # Training data (stock/ and original/ subdirs)
```

## How It Works

### 1. Web Scraping (`extract.py`)
- Uses BeautifulSoup to extract:
  - Product images (first 5)
  - Product description
  - Product price

### 2. Image Analysis (`analysis.py`)
- **AI Model**: Classifies each image as stock or original
- **pHash**: Compares images against known dropshipping product database
- Combines both methods for better accuracy

### 3. Text Analysis
- Scans description for dropshipping keywords
- Checks description length (short descriptions are suspicious)

### 4. Price Analysis
- Flags products with suspiciously low prices

### 5. Scoring
- Combines all signals into a final dropshipping probability score (0-1)
- Threshold: 0.5 (50%) for dropshipping classification

## Configuration

Edit `config.py` to customize:
- `PHASH_HAMMING_THRESHOLD`: pHash matching sensitivity
- `SUSPECT_PRICE_THRESHOLD`: Price threshold for suspicious products
- `DROPSHIP_KEYWORDS`: Keywords to look for in descriptions
- `AI_MODEL_PATH`: Path to trained AI model
- `MIN_DESC_LENGTH`: Minimum description length

## Notes

- The AI model is optional. If not trained, the system uses only pHash matching.
- For best results, train the AI model with a diverse dataset of stock and original images.
- Be respectful when scraping websites (includes delays between requests).

## Requirements

- Python 3.8+
- PyTorch (for AI model)
- See `requirements.txt` for full list

