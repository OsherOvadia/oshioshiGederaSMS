"use client";

type Props = { importToken: string; headingId?: string };

export default function UploadForm({ importToken, headingId }: Props) {
  return (
    <div style={{ marginTop: "16px" }}>
      <h2 id={headingId} style={{ marginBottom: "8px" }}>
        <span aria-hidden="true">📁 </span>ייבוא מקובץ CSV / Excel
      </h2>
      <form
        className="admin-upload-form"
        action="/api/admin/import"
        method="POST"
        encType="multipart/form-data"
      >
        <input type="hidden" name="import_token" value={importToken} />
        <div className="form-group" style={{ margin: 0, flex: "1 1 220px" }}>
          {/* A bare file input announces only "choose file"; the label says
              what file, and aria-describedby says which formats. */}
          <label htmlFor="import-file">קובץ לקוחות</label>
          <input
            type="file"
            id="import-file"
            name="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            required
            aria-describedby="import-file-hint"
          />
          <p id="import-file-hint" className="field-hint">
            נתמכים: ‎.csv‎, ‎.xlsx‎, ‎.xls‎
          </p>
        </div>
        <button type="submit" className="admin-upload-submit">
          ייבא לקוחות
        </button>
      </form>
    </div>
  );
}
