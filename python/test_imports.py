#!/usr/bin/env python3
"""
Test script to verify Python environment for PDF table extraction
"""

def test_imports():
    """Test that all required Python libraries can be imported"""
    try:
        import camelot
        print("✅ camelot imported successfully")
    except ImportError as e:
        print(f"❌ camelot import failed: {e}")
    
    try:
        import pdfplumber
        print("✅ pdfplumber imported successfully")
    except ImportError as e:
        print(f"❌ pdfplumber import failed: {e}")
    
    try:
        import tabula
        print("✅ tabula imported successfully")
    except ImportError as e:
        print(f"❌ tabula import failed: {e}")
    
    try:
        import pandas
        print("✅ pandas imported successfully")
    except ImportError as e:
        print(f"❌ pandas import failed: {e}")
    
    try:
        import numpy
        print("✅ numpy imported successfully")
    except ImportError as e:
        print(f"❌ numpy import failed: {e}")

if __name__ == "__main__":
    print("🐍 Testing Python environment for PDF table extraction...")
    print("=" * 50)
    test_imports()
    print("=" * 50)
    print("🎉 Test completed!")