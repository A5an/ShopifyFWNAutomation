#!/usr/bin/env python3
"""
Python PDF Table Extractor for Shopify FWN Automation
This script uses multiple Python libraries to extract tables from PDF files.
"""

import sys
import json
import os
from typing import Dict, List, Any
import argparse
import traceback

try:
    import camelot
    import pandas as pd
    CAMELOT_AVAILABLE = True
except ImportError:
    CAMELOT_AVAILABLE = False
    print("Warning: camelot-py not available", file=sys.stderr)

try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except ImportError:
    PDFPLUMBER_AVAILABLE = False
    print("Warning: pdfplumber not available", file=sys.stderr)

try:
    import tabula
    TABULA_AVAILABLE = True
except ImportError:
    TABULA_AVAILABLE = False
    print("Warning: tabula-py not available", file=sys.stderr)


def extract_with_camelot(pdf_path: str) -> List[Dict[str, Any]]:
    """Extract tables using camelot-py"""
    if not CAMELOT_AVAILABLE:
        return []
    
    try:
        tables = camelot.read_pdf(pdf_path, pages='all')
        result = []
        
        for i, table in enumerate(tables):
            # Convert to dict format
            df = table.df
            table_data = {
                "page": table.page,
                "method": "camelot",
                "table_number": i + 1,
                "shape": [len(df), len(df.columns)],
                "data": df.values.tolist(),
                "headers": df.columns.tolist() if not df.empty else []
            }
            result.append(table_data)
        
        return result
    except Exception as e:
        print(f"Camelot extraction failed: {str(e)}", file=sys.stderr)
        return []


def extract_with_pdfplumber(pdf_path: str) -> List[Dict[str, Any]]:
    """Extract tables using pdfplumber"""
    if not PDFPLUMBER_AVAILABLE:
        return []
    
    try:
        result = []
        
        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages):
                # Extract tables
                tables = page.extract_tables()
                
                for i, table in enumerate(tables):
                    if table:  # Check if table is not empty
                        table_data = {
                            "page": page_num + 1,
                            "method": "pdfplumber",
                            "table_number": i + 1,
                            "shape": [len(table), len(table[0]) if table else 0],
                            "data": table,
                            "headers": table[0] if table and len(table) > 0 else []
                        }
                        result.append(table_data)
        
        return result
    except Exception as e:
        print(f"PDFPlumber extraction failed: {str(e)}", file=sys.stderr)
        return []


def extract_with_tabula(pdf_path: str) -> List[Dict[str, Any]]:
    """Extract tables using tabula-py"""
    if not TABULA_AVAILABLE:
        return []
    
    try:
        # Read all pages
        dfs = tabula.read_pdf(pdf_path, pages='all', multiple_tables=True)
        result = []
        
        for i, df in enumerate(dfs):
            if isinstance(df, pd.DataFrame) and not df.empty:
                table_data = {
                    "page": "unknown",  # Tabula doesn't always provide page info
                    "method": "tabula",
                    "table_number": i + 1,
                    "shape": [len(df), len(df.columns)],
                    "data": df.values.tolist(),
                    "headers": df.columns.tolist()
                }
                result.append(table_data)
        
        return result
    except Exception as e:
        print(f"Tabula extraction failed: {str(e)}", file=sys.stderr)
        return []


def extract_all_tables(pdf_path: str) -> Dict[str, Any]:
    """Extract tables using all available methods"""
    results = {
        "camelot": extract_with_camelot(pdf_path) if CAMELOT_AVAILABLE else [],
        "pdfplumber": extract_with_pdfplumber(pdf_path) if PDFPLUMBER_AVAILABLE else [],
        "tabula": extract_with_tabula(pdf_path) if TABULA_AVAILABLE else [],
        "error": None
    }
    
    # Check if any method succeeded
    total_tables = sum(len(results[method]) for method in results if method != "error")
    
    if total_tables == 0:
        results["error"] = "No tables found with any method"
    
    return results


def find_invoice_tables(pdf_path: str) -> Dict[str, Any]:
    """Find invoice tables specifically"""
    all_tables = extract_all_tables(pdf_path)
    
    if all_tables["error"]:
        return all_tables
    
    # Filter for tables that look like invoice line items
    invoice_tables = []
    
    for method in ["camelot", "pdfplumber", "tabula"]:
        for table in all_tables[method]:
            # Heuristics to identify invoice tables:
            # 1. Should have at least 3 columns (SKU, Description, Quantity, Price)
            # 2. Should have reasonable number of rows (1-100 line items)
            # 3. Should contain typical invoice keywords (English and French)
            
            if table["shape"][1] >= 3 and 1 <= table["shape"][0] <= 100:
                # Check headers for invoice-related terms
                headers = [str(h).lower() for h in table["headers"]]
                invoice_keywords = [
                    # English
                    "item", "sku", "product", "description", "qty", "quantity", "price", "amount", "total", "unit",
                    # French (Addict invoices)
                    "libell",      # matches "libellé" or "libelle"
                    "réf", "ref", # reference/code
                    "quantité", "qté", "qte", "q.",
                    "pu",          # prix unitaire
                    "prix ht", "montant ht", "total ht", "ht"
                ]
                
                # Count how many invoice keywords are in headers
                keyword_matches = sum(1 for keyword in invoice_keywords if 
                                    any(keyword in header for header in headers))
                
                if keyword_matches >= 2:  # At least 2 invoice-related terms
                    invoice_tables.append(table)
    
    return {
        "tables": invoice_tables,
        "total_found": len(invoice_tables),
        "all_tables": all_tables
    }


def main():
    parser = argparse.ArgumentParser(description='Extract tables from PDF files')
    parser.add_argument('pdf_path', help='Path to the PDF file')
    parser.add_argument('--method', choices=['all', 'camelot', 'pdfplumber', 'tabula', 'invoice'], 
                       default='invoice', help='Extraction method')
    parser.add_argument('--output', help='Output JSON file path')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.pdf_path):
        error_result = {"error": f"File {args.pdf_path} not found"}
        print(json.dumps(error_result))
        sys.exit(1)
    
    try:
        if args.method == 'all':
            result = extract_all_tables(args.pdf_path)
        elif args.method == 'invoice':
            result = find_invoice_tables(args.pdf_path)
        else:
            # Individual method extraction
            method_map = {
                'camelot': extract_with_camelot,
                'pdfplumber': extract_with_pdfplumber,
                'tabula': extract_with_tabula
            }
            tables = method_map[args.method](args.pdf_path)
            result = {"tables": tables, "method": args.method}
        
        # Output result as JSON
        print(json.dumps(result))
            
    except Exception as e:
        error_result = {"error": str(e), "traceback": traceback.format_exc()}
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()