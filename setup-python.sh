#!/bin/bash
# Setup script for Python PDF extraction dependencies

echo "🐍 Setting up Python environment for PDF table extraction..."

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3 first."
    exit 1
fi

# Check if pip is available
if ! command -v pip3 &> /dev/null; then
    echo "❌ pip3 is not installed. Please install pip first."
    exit 1
fi

# Install requirements
echo "📦 Installing Python dependencies..."
pip3 install -r python/requirements.txt

if [ $? -eq 0 ]; then
    echo "✅ Python dependencies installed successfully!"
    
    # Test import
    echo "🧪 Testing Python imports..."
    python3 -c "
import camelot
import pdfplumber
import tabula
import pandas
print('✅ All Python libraries imported successfully!')
"
    
    if [ $? -eq 0 ]; then
        echo "🎉 Python environment is ready for PDF table extraction!"
        echo ""
        echo "To test the integration, run:"
        echo "  node test-python-integration.js"
    else
        echo "⚠️  Python imports failed. You may need to install additional system dependencies."
    fi
else
    echo "❌ Failed to install Python dependencies."
    echo "You might need to install system dependencies like Ghostscript:"
    echo "  macOS: brew install ghostscript"
    echo "  Ubuntu: sudo apt-get install ghostscript python3-tk"
    echo "  Windows: Install Ghostscript from https://www.ghostscript.com/download.html"
fi