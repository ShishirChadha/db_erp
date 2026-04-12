import csv
import sys
from datetime import datetime

def parse_date(date_str):
    """Convert various date formats to YYYY-MM-DD."""
    date_str = date_str.strip()
    if not date_str:
        return None
    # Try common formats
    for fmt in ('%d-%b-%y', '%d-%b-%Y', '%Y-%m-%d', '%d/%m/%Y'):
        try:
            return datetime.strptime(date_str, fmt).date().isoformat()
        except ValueError:
            continue
    return None

def escape_sql(val):
    """Escape single quotes and handle None."""
    if val is None:
        return 'NULL'
    val = str(val).replace("'", "''")
    return f"'{val}'"

def main(csv_path, sql_path):
    with open(csv_path, 'r', encoding='utf-8') as infile, \
         open(sql_path, 'w', encoding='utf-8') as outfile:
        
        reader = csv.DictReader(infile)
        outfile.write("-- Generated from Laptop_INVENTORY.csv\n")
        outfile.write("INSERT INTO purchases (\n")
        outfile.write("    purchase_date, vendor_name, asset_number, sku, type,\n")
        outfile.write("    asset_description, serial_number, base_price, gst,\n")
        outfile.write("    total_price, stock_status, purchased_by, purchase_type\n")
        outfile.write(") VALUES\n")
        
        first = True
        for row in reader:
            # Skip rows that are clearly summary lines (e.g., empty Type or starts with FY)
            type_val = row.get('Type', '').strip()
            if not type_val or type_val.startswith('FY') or type_val.startswith('Total'):
                continue
            
            # Map CSV fields
            pur_date = parse_date(row.get('As_Purch_DT', ''))
            vendor = row.get('Vender', '')
            asset_no = row.get('Asset_No', '')
            sku = row.get('Asset', '')
            type_ = row.get('Type', '')
            asset_desc = row.get('Asset Desc', '')
            serial = row.get('Serial_No', '')
            base = row.get('Base', '')
            gst = row.get('GST', '')
            total = row.get('AS_Price', '')
            status = row.get('Status', '')
            paid_by = row.get('Paid By', '')
            
            # Determine purchase_type
            gst_val = None
            try:
                if gst and float(gst) > 0:
                    gst_val = float(gst)
                    pur_type = 'GST'
                else:
                    pur_type = 'Cash'
            except:
                pur_type = 'Cash'
            
            # Build value string
            values = [
                escape_sql(pur_date),
                escape_sql(vendor),
                escape_sql(asset_no),
                escape_sql(sku),
                escape_sql(type_),
                escape_sql(asset_desc),
                escape_sql(serial),
                escape_sql(base),
                escape_sql(gst),
                escape_sql(total),
                escape_sql(status),
                escape_sql(paid_by),
                escape_sql(pur_type)
            ]
            
            if not first:
                outfile.write(",\n")
            outfile.write("(" + ", ".join(values) + ")")
            first = False
        
        outfile.write(";\n")
        print(f"SQL file written to {sql_path}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 csv_to_sql.py input.csv output.sql")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])