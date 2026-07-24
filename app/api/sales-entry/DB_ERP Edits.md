DB_ERP Edits
21/07/2026
 SKU should be allowed to add on runtime if now found in Step 2 of New Order
 List dropdown shall be available in NEw SKU entry for all CPU, RAM GEN ext
 SKU Code formulation seems to be incorrect and variant logic should be recheck if in case of multiple RAM and SSD combination
 Total befor GST and grand total logic needs to be checked as when quantity is increased then sum is coming incorrect in Step 2 of New Purchase Order
 Asset number logic needs to be revisited - When I raised new purchase order for 5 laptops, it generated from DBAS26-699 to DBAS26-705, however last DB asset number was DBAS682. First all all ASset number shall be correct as per prefix year DBAS26- for 2026 and DBAS25- for 2025 same for TT and CC
 Also how come you created test assets DBAS26-698,693,690 without PO Date or PI and I cannot even delete it from UI because I dont see them in PO. I saw them in Stock/Assets tab. There should be a delete entry and if you are testing then kindly follow proper process of creating PO and PI.


With respect to New Entry -
We need to make asset number blank and auto fill once owner make PO entries
same flag would update basis serial number once PO generated on invoice generated.
Whereas stock/sold report would be different for employee and other fetched from actuall PO and invoice generation. This will also help reconcile real stock with employee visa ve PO internal generated. Because sometime, employee would perform QC late and owner may generate PO early. so you need to think about this as well wrt to flagging.
Owner Review still shows pending stock, i still think that is irrelevant. PLease remove Owner review tab. and Just make Employee current/sold stock editable for owner only.