import datetime
import enum
from typing import List
from uuid import uuid4

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# tables


def _uuid():
    return uuid4().hex


class AnnotationType(enum.Enum):
    Image = "img"
    Text = "txt"
    Table = "tbl"


class Base(DeclarativeBase):
    pass


class DbPdf(Base):
    __tablename__ = "pdfs"
    id: Mapped[String] = mapped_column(String, primary_key=True, default=_uuid)
    s3_key = Column(String)
    file_name = Column(String)
    size = Column(Integer)
    source = Column(String)
    source_id = Column(String)
    name = Column(String)
    doi = Column(String)
    created_date = Column(DateTime, default=datetime.datetime.utcnow)
    annotations: Mapped[List["DbAnnotation"]] = relationship(back_populates="doc", cascade="all,delete")
    doc_info: Mapped["DbDocInfo"] = relationship(back_populates="doc", cascade="all,delete")


class DbDocInfo(Base):
    __tablename__ = "pdf_info"
    id: Mapped[String] = mapped_column(String, primary_key=True, default=_uuid)
    doc: Mapped[DbPdf] = relationship(back_populates="doc_info")
    doc_id: Mapped[String] = mapped_column(ForeignKey("pdfs.id"))
    doi = Column(String, default="")
    name = Column(String, default="")
    authors = Column(String, default="")
    journal = Column(String, default="")
    uri = Column(String, default="")
    title = Column(String, default="")
    year = Column(String, default="")
    month = Column(String, default="")
    volume = Column(String, default="")
    issue = Column(String, default="")
    description = Column(String, default="")
    xdd_id = Column(String, default="")


class DbAnnotation(Base):
    __tablename__ = "annotations"

    id = Column(String, primary_key=True, default=_uuid)
    doc_id: Mapped[String] = mapped_column(ForeignKey("pdfs.id"))
    doc: Mapped[DbPdf] = relationship(back_populates="annotations")
    annotation_type = Column(String)
    tags: Mapped[List["DbAnnotationTag"]] = relationship(back_populates="annotation", cascade="all,delete")
    page = Column(Integer)
    x0 = Column(Float)
    y0 = Column(Float)
    x1 = Column(Float)
    y1 = Column(Float)
    created_date = Column(DateTime, default=datetime.datetime.utcnow)


class DbAnnotationTag(Base):
    __tablename__ = "annotation_tags"

    id = Column(String, primary_key=True, default=_uuid)
    annotation_id: Mapped[String] = mapped_column(ForeignKey("annotations.id", ondelete="CASCADE"))
    annotation: Mapped[DbAnnotation] = relationship(back_populates="tags")
    label = Column(String)
    value = Column(String)
    comment = Column(String)
    created_date = Column(DateTime, default=datetime.datetime.utcnow)
