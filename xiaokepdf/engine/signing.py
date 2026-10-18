"""數位簽章：用 .p12 / .pfx 憑證簽署（可見或不可見）、驗證簽章、建立自簽憑證。（pyHanko）"""
import datetime
import io
import os

from .. import data_dir


def cert_dir():
    return data_dir("certs")


def list_certs():
    d = cert_dir()
    return sorted(f for f in os.listdir(d) if f.lower().endswith((".p12", ".pfx")))


def import_cert(path):
    import shutil
    dst = os.path.join(cert_dir(), os.path.basename(path))
    shutil.copyfile(path, dst)
    return os.path.basename(dst)


def describe(p12_bytes, password):
    from cryptography.hazmat.primitives.serialization import pkcs12
    key, cert, extra = pkcs12.load_key_and_certificates(p12_bytes, password.encode() if password else None)
    cn = cert.subject.rfc4514_string()
    return {"subject": cn, "issuer": cert.issuer.rfc4514_string(), "not_after": cert.not_valid_after_utc.strftime("%Y-%m-%d"),
            "self_signed": cert.subject == cert.issuer}


def create_self_signed(name, email, password, years=3):
    """建立自簽憑證（RSA 2048），存成 .p12，回傳檔名。"""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    attrs = [x509.NameAttribute(NameOID.COMMON_NAME, name)]
    if email:
        attrs.append(x509.NameAttribute(NameOID.EMAIL_ADDRESS, email))
    subject = x509.Name(attrs)
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(minutes=5))
            .not_valid_after(now + datetime.timedelta(days=365 * years))
            .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=True, key_encipherment=False, data_encipherment=False,
                                         key_agreement=False, key_cert_sign=False, crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.EMAIL_PROTECTION]), critical=False)
            .sign(key, hashes.SHA256()))
    data = pkcs12.serialize_key_and_certificates(name.encode(), key, cert, None,
                                                 serialization.BestAvailableEncryption(password.encode()) if password else serialization.NoEncryption())
    fn = "%s.p12" % "".join(c for c in name if c not in '\\/:*?"<>|')
    with open(os.path.join(cert_dir(), fn), "wb") as f:
        f.write(data)
    return fn


def sign(pdf_bytes, p12_path, password, reason="", location="", name=None, page=0, rect=None, field="Signature1"):
    """簽署（增量更新，原本的內容不會變）。rect：可見簽章的位置（PDF 座標 x1,y1,x2,y2），None＝不可見。"""
    from pyhanko.sign import signers, fields
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign.fields import SigFieldSpec

    signer = signers.SimpleSigner.load_pkcs12(p12_path, passphrase=password.encode() if password else None)
    w = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes), strict=False)
    existing = [f for f, _, _ in fields.enumerate_sig_fields(w)]
    k = 1
    while field in existing:
        k += 1
        field = "Signature%d" % k
    spec = SigFieldSpec(sig_field_name=field, on_page=page, box=tuple(rect) if rect else None)
    fields.append_signature_field(w, spec)
    meta = signers.PdfSignatureMetadata(field_name=field, reason=reason or None, location=location or None, name=name)
    out = io.BytesIO()
    signers.PdfSigner(meta, signer=signer).sign_pdf(w, output=out)
    return out.getvalue()


def verify(pdf_bytes):
    """驗證文件裡所有的簽章：[{field, signer, time, intact, valid, coverage, trusted}]"""
    import logging
    for name in ("pyhanko", "pyhanko_certvalidator"):
        logging.getLogger(name).setLevel(logging.CRITICAL)
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.validation import validate_pdf_signature
    from pyhanko_certvalidator import ValidationContext

    r = PdfFileReader(io.BytesIO(pdf_bytes), strict=False)
    out = []
    for sig in r.embedded_signatures:
        item = {"field": sig.field_name, "signer": "", "time": "", "intact": False, "valid": False, "coverage": "", "trusted": False}
        try:
            item["signer"] = sig.signer_cert.subject.human_friendly
        except Exception:
            pass
        try:
            st = validate_pdf_signature(sig, ValidationContext(allow_fetching=False))
            item["intact"] = bool(st.intact)
            item["valid"] = bool(st.valid)
            item["trusted"] = bool(st.trusted)
            item["coverage"] = "涵蓋整份文件" if "ENTIRE_FILE" in str(st.coverage) else ("簽署後有修改" if st.modification_level is not None and "NONE" not in str(st.modification_level) else "涵蓋簽署時的版本")
            if st.signer_reported_dt:
                item["time"] = st.signer_reported_dt.astimezone().strftime("%Y-%m-%d %H:%M")
        except Exception as e:
            item["error"] = str(e)
        out.append(item)
    return out
